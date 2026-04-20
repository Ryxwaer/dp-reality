package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"dp-reality/notification/internal/config"
	"dp-reality/notification/internal/emailer"
	"dp-reality/notification/internal/models"
	"dp-reality/notification/internal/notify"
	"dp-reality/notification/internal/repository"
	"dp-reality/notification/internal/specmatcher"
)

const (
	scrapeExchange = "scrape.completed"
	scrapeQueue    = "notification.scrape.completed"

	botCreatedExchange = "bot.created"
	botCreatedQueue    = "notification.bot.created"

	// Window used for the initial digest sent when a user creates a bot.
	initialDigestWindow = 24 * time.Hour
)

// processScrapeEvent handles a scrape.completed message. Since the
// bot-owned matcher rework, there is no module-level join in this hot
// path: every active bot carries its own compiled matcher and
// notification spec (snapshotted at save time). The flow is therefore:
//
//  1. Load all users with at least one active bot scoped to
//     (source, collection).
//  2. For every such bot, push the matcher down to Mongo —
//     `<collection>.find({run_id: E.RunID} AND Compile(bot.Matcher))` —
//     so the DB returns exactly the rows this bot cares about.
//  3. Apply `bot.Notification` to each matched listing, persist the
//     resolved rows to `notifications`, and (if any bot on the user
//     wanted email) emit one digest per (user, source).
//
// There's no per-user dedup read against `notifications` —
// $setOnInsert(run_id) upstream is the authoritative cursor.
func processScrapeEvent(ctx context.Context, event models.ScrapeEvent, repo *repository.Repository, cfg config.Config) error {
	slog.Info("received scrape.completed",
		"run_id", event.RunID, "source", event.Source, "collection", event.Collection)

	if event.RunID == "" || event.Source == "" || event.Collection == "" {
		slog.Warn("scrape.completed missing required fields, dropping",
			"run_id", event.RunID, "source", event.Source, "collection", event.Collection)
		return nil
	}

	users, err := repo.FetchActiveUsersForScope(ctx, event.Source, event.Collection)
	if err != nil {
		return fmt.Errorf("fetch users: %w", err)
	}
	if len(users) == 0 {
		slog.Info("no active users for scope",
			"source", event.Source, "collection", event.Collection)
		return nil
	}

	now := time.Now().UTC()
	for _, user := range users {
		if err := processUserForRun(ctx, user, event, now, repo, cfg); err != nil {
			slog.Error("process user failed", "user", user.Email, "err", err)
			continue
		}
	}
	return nil
}

// processUserForRun runs one Mongo query per active bot (scoped to the
// event) and aggregates per-source digests. Isolated so one user's
// failure doesn't poison the rest of the batch.
//
// One query per bot is simpler than building a single `$or` union and
// scales fine at ~10k users / ~100 modules because every query is
// anchored by the compound `run_id` + matcher fields index. If we ever
// need to reduce the query count, we can batch identical compiled
// matchers (same module, same config) into a single find() without
// changing the matcher shape.
func processUserForRun(
	ctx context.Context,
	user models.User,
	event models.ScrapeEvent,
	now time.Time,
	repo *repository.Repository,
	cfg config.Config,
) error {
	type digestBucket struct {
		spec models.NotificationSpec
		rows []models.ResolvedRow
	}
	var rows []models.Notification
	perSource := map[string]*digestBucket{}
	wantsEmail := map[string]bool{}

	for _, bot := range user.Bots {
		if !bot.IsActive() {
			continue
		}
		if bot.Source != event.Source || bot.Collection != event.Collection {
			continue
		}
		filter, err := specmatcher.Compile(bot.Matcher.Filters)
		if err != nil {
			slog.Warn("skip bot with invalid matcher",
				"user", user.Email, "bot", bot.ID, "err", err)
			continue
		}
		matches, err := repo.FindBotMatches(ctx, bot.Collection, event.RunID, filter)
		if err != nil {
			slog.Error("find bot matches failed",
				"user", user.Email, "bot", bot.ID, "err", err)
			continue
		}
		if len(matches) == 0 {
			continue
		}
		for _, l := range matches {
			resolved, ok := notify.Apply(bot.Notification, l.AsDoc())
			if !ok {
				slog.Warn("notification spec resolved empty title/url",
					"bot", bot.ID, "source_id", l.SourceID)
				continue
			}
			rows = append(rows, models.NotificationFromResolved(user.ID, bot.ID, l, event.RunID, resolved, now))
			if bot.EmailNotifications {
				wantsEmail[bot.Source] = true
			}
			b, ok := perSource[bot.Source]
			if !ok {
				b = &digestBucket{spec: bot.Notification}
				perSource[bot.Source] = b
			}
			b.rows = append(b.rows, resolved)
		}
	}

	if len(rows) == 0 {
		return nil
	}

	inserted, err := repo.InsertNotifications(ctx, user.ID, rows)
	if err != nil {
		return fmt.Errorf("persist notifications: %w", err)
	}
	if len(inserted) == 0 {
		// A redelivered scrape event: everything we tried to insert
		// was already there from a previous consume. Emailing again
		// would be spam, so skip.
		return nil
	}

	for src, b := range perSource {
		if !wantsEmail[src] {
			continue
		}
		if err := emailer.SendDigest(cfg, user, src, b.spec, b.rows); err != nil {
			slog.Error("send digest failed", "user", user.Email, "source", src, "err", err)
			continue
		}
		slog.Info("notified user",
			"user", user.Email, "source", src, "rows", len(b.rows))
	}
	return nil
}

// processBotCreatedEvent handles bot.created: sends a one-off 24h
// digest for the newly created bot (or a short welcome email if
// nothing matched in the window) and records inbox rows for the
// matches. Unlike the scrape path, this ignores `run_id` and scans
// the whole 24h window — a brand-new bot should see every recent
// listing that fits its filter, including ones from earlier runs.
func processBotCreatedEvent(ctx context.Context, event models.BotCreatedEvent, repo *repository.Repository, cfg config.Config) error {
	slog.Info("received bot.created", "user_id", event.UserID, "bot_id", event.BotID)

	user, err := repo.FetchUserByID(ctx, event.UserID)
	if err != nil {
		if errors.Is(err, mongo.ErrNoDocuments) {
			slog.Warn("bot.created for unknown user, dropping", "user_id", event.UserID)
			return nil
		}
		return fmt.Errorf("fetch user: %w", err)
	}

	var bot *models.BotConfig
	for i := range user.Bots {
		if user.Bots[i].ID == event.BotID {
			bot = &user.Bots[i]
			break
		}
	}
	if bot == nil {
		slog.Warn("bot.created for unknown bot id, dropping", "user_id", event.UserID, "bot_id", event.BotID)
		return nil
	}
	if bot.Status == models.BotStatusDeleted {
		return nil
	}
	if bot.Collection == "" {
		slog.Warn("bot.created with empty collection, dropping", "bot_id", bot.ID)
		return nil
	}

	now := time.Now().UTC()
	start := now.Add(-initialDigestWindow)

	listings, err := repo.FetchListingsBetween(ctx, bot.Collection, start, now)
	if err != nil {
		return fmt.Errorf("fetch listings from %q: %w", bot.Collection, err)
	}

	var matchedRows []models.ResolvedRow
	var inboxRows []models.Notification
	for _, l := range listings {
		if !specmatcher.Evaluate(bot.Matcher.Filters, l) {
			continue
		}
		resolved, ok := notify.Apply(bot.Notification, l.AsDoc())
		if !ok {
			continue
		}
		matchedRows = append(matchedRows, resolved)
		inboxRows = append(inboxRows, models.NotificationFromResolved(user.ID, bot.ID, l, l.RunID, resolved, now))
	}

	// Send the digest even with zero matches — that's the "bot is
	// active, nothing yet" confirmation email the user expects.
	if bot.EmailNotifications {
		if err := emailer.SendInitialDigest(cfg, *user, *bot, bot.Source, matchedRows); err != nil {
			return fmt.Errorf("initial digest for %s: %w", user.Email, err)
		}
	}

	if len(inboxRows) == 0 {
		return nil
	}
	if _, err := repo.InsertNotifications(ctx, user.ID, inboxRows); err != nil {
		slog.Warn("persist initial-digest matches failed", "user", user.Email, "err", err)
	}
	return nil
}

// subscribe declares a durable fanout exchange + queue, binds them, and
// returns the delivery channel. Used identically by both consumer types.
func subscribe(ch *amqp.Channel, exchange, queue string) (<-chan amqp.Delivery, error) {
	if err := ch.ExchangeDeclare(exchange, "fanout", true, false, false, false, nil); err != nil {
		return nil, fmt.Errorf("declare exchange %q: %w", exchange, err)
	}
	q, err := ch.QueueDeclare(queue, true, false, false, false, nil)
	if err != nil {
		return nil, fmt.Errorf("declare queue %q: %w", queue, err)
	}
	if err := ch.QueueBind(q.Name, "", exchange, false, nil); err != nil {
		return nil, fmt.Errorf("bind queue %q: %w", queue, err)
	}
	if err := ch.Qos(10, 0, false); err != nil {
		return nil, fmt.Errorf("set qos: %w", err)
	}
	deliveries, err := ch.Consume(q.Name, "", false, false, false, false, nil)
	if err != nil {
		return nil, fmt.Errorf("start consume on %q: %w", queue, err)
	}
	return deliveries, nil
}

// Start runs both consumers (scrape.completed + bot.created) in parallel
// and returns when ctx is cancelled or one of them fails fatally.
func Start(ctx context.Context, conn *amqp.Connection, repo *repository.Repository, cfg config.Config) error {
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}

	scrapeDeliveries, err := subscribe(ch, scrapeExchange, scrapeQueue)
	if err != nil {
		return err
	}
	botDeliveries, err := subscribe(ch, botCreatedExchange, botCreatedQueue)
	if err != nil {
		return err
	}

	slog.Info("consumer ready", "queues", []string{scrapeQueue, botCreatedQueue})

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-scrapeDeliveries:
			if !ok {
				return fmt.Errorf("scrape delivery channel closed")
			}
			handleDelivery(ctx, msg, func(ctx context.Context, body []byte) error {
				var event models.ScrapeEvent
				if err := json.Unmarshal(body, &event); err != nil {
					return fmt.Errorf("parse scrape event: %w", err)
				}
				return processScrapeEvent(ctx, event, repo, cfg)
			})
		case msg, ok := <-botDeliveries:
			if !ok {
				return fmt.Errorf("bot.created delivery channel closed")
			}
			handleDelivery(ctx, msg, func(ctx context.Context, body []byte) error {
				var event models.BotCreatedEvent
				if err := json.Unmarshal(body, &event); err != nil {
					return fmt.Errorf("parse bot.created event: %w", err)
				}
				return processBotCreatedEvent(ctx, event, repo, cfg)
			})
		}
	}
}

// handleDelivery runs `fn` with a bounded timeout and Acks / Nacks
// appropriately. A parse failure is Nacked without requeue (poison message),
// a processing failure is Nacked with requeue so it will retry.
func handleDelivery(ctx context.Context, msg amqp.Delivery, fn func(context.Context, []byte) error) {
	processCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	if err := fn(processCtx, msg.Body); err != nil {
		var syntaxErr *json.SyntaxError
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &syntaxErr) || errors.As(err, &typeErr) {
			slog.Warn("dropping malformed message", "err", err)
			_ = msg.Nack(false, false)
			return
		}
		slog.Error("processing failed, requeueing", "err", err)
		_ = msg.Nack(false, true)
		return
	}
	_ = msg.Ack(false)
}
