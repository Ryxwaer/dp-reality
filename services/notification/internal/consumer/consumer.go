package consumer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"dp-reality/notification/internal/config"
	"dp-reality/notification/internal/emailer"
	"dp-reality/notification/internal/matcher"
	"dp-reality/notification/internal/models"
	"dp-reality/notification/internal/repository"
)

const (
	exchangeName = "scrape.completed"
	queueName    = "notification.scrape.completed"
	// Listings published before this window are considered too old to notify about,
	// guarding against a cursor reset causing a flood of old listings on first run.
	maxLookbackHours = 48
)

func processEvent(ctx context.Context, event models.ScrapeEvent, repo *repository.Repository, cfg config.Config) error {
	slog.Info("received scrape.completed", "source", event.Source, "new_count", event.NewCount)

	users, err := repo.FetchActiveUsers(ctx)
	if err != nil {
		return fmt.Errorf("fetch users: %w", err)
	}
	if len(users) == 0 {
		slog.Info("no active users, skipping")
		return nil
	}

	// Find the earliest cursor across all users so we make a single DB query.
	floor := time.Now().UTC().Add(-maxLookbackHours * time.Hour)
	earliest := floor
	for _, u := range users {
		if u.LastNotifiedAt != nil && u.LastNotifiedAt.After(floor) {
			if u.LastNotifiedAt.Before(earliest) || earliest == floor {
				earliest = *u.LastNotifiedAt
			}
		}
	}

	listings, err := repo.FetchListingsSince(ctx, earliest)
	if err != nil {
		return fmt.Errorf("fetch listings: %w", err)
	}
	if len(listings) == 0 {
		slog.Info("no new listings to notify about")
		return nil
	}

	slog.Info("matching listings to users", "listing_count", len(listings), "user_count", len(users))
	now := time.Now().UTC()

	for _, user := range users {
		// Per-user cutoff: only listings the user has not seen yet.
		var since time.Time
		if user.LastNotifiedAt != nil {
			since = *user.LastNotifiedAt
		} else {
			since = floor
		}

		var unseen []models.Listing
		for _, l := range listings {
			if l.FirstSeen.After(since) {
				unseen = append(unseen, l)
			}
		}
		if len(unseen) == 0 {
			continue
		}

		matched := matcher.MatchForUser(unseen, user)
		if len(matched) == 0 {
			continue
		}

		if err := emailer.Send(cfg, user, matched); err != nil {
			slog.Error("failed to send email", "user", user.Email, "err", err)
			continue
		}

		if err := repo.AdvanceUserCursor(ctx, user.ID, now); err != nil {
			slog.Warn("failed to advance user cursor", "user", user.Email, "err", err)
		}
	}

	return nil
}

func Start(ctx context.Context, conn *amqp.Connection, repo *repository.Repository, cfg config.Config) error {
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}

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

	if err := ch.Qos(10, 0, false); err != nil {
		return fmt.Errorf("set qos: %w", err)
	}

	deliveries, err := ch.Consume(q.Name, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("start consume: %w", err)
	}

	slog.Info("consumer ready", "queue", queueName)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("delivery channel closed")
			}
			var event models.ScrapeEvent
			if err := json.Unmarshal(msg.Body, &event); err != nil {
				slog.Warn("failed to parse message", "err", err)
				_ = msg.Nack(false, false)
				continue
			}
			processCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
			if err := processEvent(processCtx, event, repo, cfg); err != nil {
				slog.Error("event processing failed, requeueing", "err", err)
				cancel()
				_ = msg.Nack(false, true)
				continue
			}
			cancel()
			_ = msg.Ack(false)
		}
	}
}
