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

	initialDigestWindow = 24 * time.Hour
)

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
