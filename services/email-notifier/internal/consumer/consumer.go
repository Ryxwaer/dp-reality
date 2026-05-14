// notify.bot.processed consumer.
//
// A bot service publishes one event per (user, bot, run) once a scrape
// cycle has appended at least one notification row for that user
// across any of their configs in that bot. We send a digest immediately
// on receipt — no coalescing, no batch window. The window of "did the
// next event for this user/bot supersede us?" was always small in
// practice, and the cost of a stretched-out scrape cadence is way
// lower than the cost of dropping a digest because two events arrived
// nearby.
//
// The AMQP `ack` is deferred until the digest has been sent AND the
// affected notification rows have been marked sent_at. If anything in
// that chain fails, the message is `Nack`'d for redelivery; the
// (user_id, bot_id, source_ref) unique index keeps inserts
// idempotent and we never lose a row.
package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/v2/bson"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/emailer"
	"dp-reality/email-notifier/internal/repository"
)

const (
	exchangeName = "notify.bot.processed"
	queueName    = "email-notifier.bot.processed"
)

type Event struct {
	UserID string `json:"user_id"`
	BotID  string `json:"bot_id"`
	RunID  string `json:"run_id"`
}

// Service ties together the AMQP delivery loop and the synchronous
// digest send.
type Service struct {
	cfg  config.Config
	repo *repository.Repository
}

func New(cfg config.Config, repo *repository.Repository) *Service {
	return &Service{cfg: cfg, repo: repo}
}

// Start runs both consumers in parallel:
//   - notify.bot.processed — digest sent immediately on receipt;
//   - notify.bot.welcome   — one-shot welcome confirmation.
//
// They share the AMQP connection but each opens its own channel so a
// channel-level close on one stream cannot stall the other.
func (s *Service) Start(ctx context.Context, conn *amqp.Connection) error {
	errCh := make(chan error, 2)
	go func() { errCh <- s.startProcessed(ctx, conn) }()
	go func() { errCh <- s.startWelcome(ctx, conn) }()

	// Return on the first failure so main can decide whether to exit
	// or reconnect. Whichever consumer survives still has its context
	// cancelled when we return.
	return <-errCh
}

func (s *Service) startProcessed(ctx context.Context, conn *amqp.Connection) error {
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	defer ch.Close()

	if err := ch.ExchangeDeclare(exchangeName, "fanout", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare exchange: %w", err)
	}
	q, err := ch.QueueDeclare(queueName, true, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("declare queue: %w", err)
	}
	if err := ch.QueueBind(q.Name, "", exchangeName, false, nil); err != nil {
		return fmt.Errorf("bind queue: %w", err)
	}
	// prefetch=1 keeps the immediate-send model honest: we do not
	// pull a second message until the first has been digested + acked.
	if err := ch.Qos(1, 0, false); err != nil {
		return fmt.Errorf("set qos: %w", err)
	}
	deliveries, err := ch.Consume(q.Name, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume: %w", err)
	}

	slog.Info("consumer ready",
		"queue", queueName,
		"exchange", exchangeName,
	)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-deliveries:
			if !ok {
				return errors.New("delivery channel closed")
			}
			s.handle(ctx, msg)
		}
	}
}

// handle parses one event, sends the digest, and only then acks. Any
// error along the way nacks for redelivery (the broker's redelivery
// will re-try; persistent failures end up dead-lettered per the broker
// policy). We do NOT ack on failure — that would silently drop work.
func (s *Service) handle(ctx context.Context, msg amqp.Delivery) {
	var ev Event
	if err := json.Unmarshal(msg.Body, &ev); err != nil {
		slog.Warn("dropping malformed event", "err", err)
		_ = msg.Nack(false, false)
		return
	}
	if ev.UserID == "" || ev.BotID == "" {
		slog.Warn("dropping event with missing fields",
			"user_id", ev.UserID, "bot_id", ev.BotID)
		_ = msg.Nack(false, false)
		return
	}

	if err := s.flush(ctx, ev.UserID, ev.BotID); err != nil {
		slog.Error("flush failed; requeueing",
			"user_id", ev.UserID, "bot_id", ev.BotID, "err", err)
		_ = msg.Nack(false, true)
		return
	}
	_ = msg.Ack(false)
}

// flush sends the digest envelope for one (user, bot) and stamps
// sent_at on every row that went out. Returns nil if there was simply
// nothing to send (gone user, no opted-in configs, no unsent rows).
func (s *Service) flush(ctx context.Context, userID, botID string) error {
	user, err := s.repo.FetchUser(ctx, userID)
	if err != nil {
		if repository.IsNotFound(err) {
			slog.Info("user no longer exists, skipping",
				"user_id", userID, "bot_id", botID)
			return nil
		}
		return fmt.Errorf("fetch user: %w", err)
	}

	// Confirm the user has at least one active + opted-in config for
	// the firing bot. With the (user_id, bot_id, source_ref) unique
	// index, the notification row is already deduplicated across the
	// user's configs of this bot, so the digest is a single envelope
	// covering every matching listing for this (user, bot) cycle.
	configs := configsForBot(user.Bots, botID)
	if len(configs) == 0 {
		slog.Info("no opted-in configs for bot on this user, skipping",
			"user_id", userID, "bot_id", botID)
		return nil
	}

	rows, err := s.repo.FetchUnsentForBot(ctx, userID, botID)
	if err != nil {
		return fmt.Errorf("fetch unsent: %w", err)
	}
	if len(rows) == 0 {
		return nil
	}

	// Pass any matching bot row as the envelope label — they all share
	// the same bot_id, only the per-config name differs.
	label := configs[0]
	if err := emailer.SendDigest(s.cfg, *user, label, rows); err != nil {
		return fmt.Errorf("send digest: %w", err)
	}

	ids := make([]bson.ObjectID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	if err := s.repo.MarkSent(ctx, ids, time.Now().UTC()); err != nil {
		// Digest is already out the door. Failing here would re-send
		// the same rows on the next event for this bucket, so we MUST
		// surface this as a hard error so the broker can keep the
		// redelivery for sent_at to settle.
		return fmt.Errorf("mark sent: %w", err)
	}
	return nil
}

// configsForBot returns every active, opted-in config of `botID` that
// belongs to the user. Used to translate the per-(user, bot) event into
// the set of config_ids whose unsent rows should be drained into a
// single digest.
func configsForBot(bots []repository.Bot, botID string) []repository.Bot {
	out := make([]repository.Bot, 0, len(bots))
	for i := range bots {
		b := bots[i]
		if b.BotID != botID {
			continue
		}
		if !b.EmailNotifications || b.Status != "active" {
			continue
		}
		out = append(out, b)
	}
	return out
}
