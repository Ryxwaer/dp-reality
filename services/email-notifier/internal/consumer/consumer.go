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
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/emailer"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/telemetry"
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

type Service struct {
	cfg  config.Config
	repo *repository.Repository
}

func New(cfg config.Config, repo *repository.Repository) *Service {
	return &Service{cfg: cfg, repo: repo}
}

func (s *Service) Start(ctx context.Context, conn *amqp.Connection) error {
	errCh := make(chan error, 2)
	go func() { errCh <- s.startProcessed(ctx, conn) }()
	go func() { errCh <- s.startWelcome(ctx, conn) }()
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

func (s *Service) handle(ctx context.Context, msg amqp.Delivery) {
	ctx = telemetry.ExtractAMQP(ctx, msg.Headers)
	ctx, span := telemetry.Tracer().Start(ctx, "notify.bot.processed receive",
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "rabbitmq"),
			attribute.String("messaging.destination.name", exchangeName),
			attribute.String("messaging.operation", "receive"),
		))
	defer span.End()

	var ev Event
	if err := json.Unmarshal(msg.Body, &ev); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "malformed event")
		slog.Warn("dropping malformed event", "err", err)
		_ = msg.Nack(false, false)
		return
	}
	if ev.UserID == "" || ev.BotID == "" {
		span.SetStatus(codes.Error, "missing fields")
		slog.Warn("dropping event with missing fields",
			"user_id", ev.UserID, "bot_id", ev.BotID)
		_ = msg.Nack(false, false)
		return
	}

	span.SetAttributes(
		attribute.String("user.id", ev.UserID),
		attribute.String("bot.id", ev.BotID),
		attribute.String("run.id", ev.RunID),
	)

	if err := s.flush(ctx, ev.UserID, ev.BotID); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "flush failed")
		slog.Error("flush failed; requeueing",
			"user_id", ev.UserID, "bot_id", ev.BotID, "err", err)
		_ = msg.Nack(false, true)
		return
	}
	_ = msg.Ack(false)
}

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

	label := configs[0]
	if err := emailer.SendDigest(s.cfg, *user, label, rows); err != nil {
		return fmt.Errorf("send digest: %w", err)
	}

	ids := make([]bson.ObjectID, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	if err := s.repo.MarkSent(ctx, ids, time.Now().UTC()); err != nil {
		return fmt.Errorf("mark sent: %w", err)
	}
	return nil
}

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
