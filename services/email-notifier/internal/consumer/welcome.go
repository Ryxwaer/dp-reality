// notify.bot.welcome consumer.
//
// Welcome events are emitted exactly once per configuration creation
// by the owning bot service. The payload is event-carried state: it
// includes the user_id, config_id, bot_id, subject, and a fully-
// rendered HTML card authored by the bot. We never look at listings
// or templates here — the welcome path does NOT touch the
// notifications collection at all.
//
// Sent immediately on receipt (no coalescing): welcomes are rare,
// one-per-config-per-lifetime events, and the user expects an instant
// confirmation.
package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	amqp "github.com/rabbitmq/amqp091-go"

	"dp-reality/email-notifier/internal/emailer"
	"dp-reality/email-notifier/internal/repository"
)

const (
	welcomeExchangeName = "notify.bot.welcome"
	welcomeQueueName    = "email-notifier.bot.welcome"
)

// WelcomeEvent is the contract published by every bot service. The
// notifier treats `subject` and `html` as opaque, ready-to-send
// strings. `ConfigID` identifies the per-user configuration; `BotID`
// identifies the platform-wide service that emitted the event (the
// compose / k8s service name) and is used only for logging.
type WelcomeEvent struct {
	UserID   string `json:"user_id"`
	ConfigID string `json:"config_id"`
	BotID    string `json:"bot_id"`
	Subject  string `json:"subject"`
	HTML     string `json:"html"`
}

func (s *Service) startWelcome(ctx context.Context, conn *amqp.Connection) error {
	ch, err := conn.Channel()
	if err != nil {
		return fmt.Errorf("open channel: %w", err)
	}
	// Channel lifetime tied to the goroutine; closed implicitly when
	// the connection drops, otherwise on context cancellation below.
	defer ch.Close()

	if err := ch.ExchangeDeclare(welcomeExchangeName, "fanout", true, false, false, false, nil); err != nil {
		return fmt.Errorf("declare welcome exchange: %w", err)
	}
	q, err := ch.QueueDeclare(welcomeQueueName, true, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("declare welcome queue: %w", err)
	}
	if err := ch.QueueBind(q.Name, "", welcomeExchangeName, false, nil); err != nil {
		return fmt.Errorf("bind welcome queue: %w", err)
	}
	if err := ch.Qos(20, 0, false); err != nil {
		return fmt.Errorf("set welcome qos: %w", err)
	}
	deliveries, err := ch.Consume(q.Name, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume welcome: %w", err)
	}

	slog.Info("welcome consumer ready",
		"queue", welcomeQueueName,
		"exchange", welcomeExchangeName,
	)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case msg, ok := <-deliveries:
			if !ok {
				return errors.New("welcome delivery channel closed")
			}
			s.handleWelcome(ctx, msg)
		}
	}
}

func (s *Service) handleWelcome(ctx context.Context, msg amqp.Delivery) {
	var ev WelcomeEvent
	if err := json.Unmarshal(msg.Body, &ev); err != nil {
		slog.Warn("welcome: dropping malformed event", "err", err)
		_ = msg.Nack(false, false)
		return
	}
	if ev.UserID == "" || ev.ConfigID == "" || ev.HTML == "" {
		slog.Warn("welcome: dropping event with missing fields",
			"user_id", ev.UserID, "config_id", ev.ConfigID,
			"bot_id", ev.BotID, "html_len", len(ev.HTML))
		_ = msg.Nack(false, false)
		return
	}

	user, err := s.repo.FetchUser(ctx, ev.UserID)
	if err != nil {
		if repository.IsNotFound(err) {
			slog.Info("welcome: user no longer exists, skipping",
				"user_id", ev.UserID, "config_id", ev.ConfigID)
			_ = msg.Ack(false)
			return
		}
		slog.Error("welcome: fetch user failed",
			"user_id", ev.UserID, "err", err)
		_ = msg.Nack(false, true)
		return
	}

	bot := findConfig(user.Bots, ev.ConfigID)
	if bot == nil {
		// Configuration was deleted between welcome publish and our
		// consumption. Nothing to confirm; drop the event.
		slog.Info("welcome: config no longer present on user, skipping",
			"user_id", ev.UserID, "config_id", ev.ConfigID)
		_ = msg.Ack(false)
		return
	}
	// Welcome is a confirmation of a save action — the same per-config
	// email_notifications switch that gates digests gates this too.
	// "pending" is accepted because the bot publishes the welcome
	// from inside its insert handler, before the BFF has had a chance
	// to flip users.bots[].status from "pending" to "active"; without
	// this the welcome would race-skip every time on fast hardware.
	if !bot.EmailNotifications || (bot.Status != "active" && bot.Status != "pending") {
		slog.Debug("welcome: bot opted out or inactive, skipping",
			"user_id", ev.UserID, "config_id", ev.ConfigID,
			"status", bot.Status, "email", bot.EmailNotifications)
		_ = msg.Ack(false)
		return
	}

	if err := emailer.SendWelcome(s.cfg, *user, ev.Subject, ev.HTML); err != nil {
		// Welcome is a one-shot confirmation: nice to have, not worth
		// retrying. Ack on failure to avoid hammering the upstream SMTP
		// (and the log) when it rate-limits or rejects us. The user
		// will still see matching listings in the inbox via the regular
		// notify.bot.processed path on the next scrape cycle.
		slog.Warn("welcome: send failed, dropping (no retry)",
			"user_id", ev.UserID, "config_id", ev.ConfigID, "err", err)
		_ = msg.Ack(false)
		return
	}

	slog.Info("welcome sent",
		"user", user.Email, "config_id", ev.ConfigID, "bot_id", ev.BotID)
	_ = msg.Ack(false)
}

// findConfig returns the user.bots[] entry whose ConfigID matches —
// the welcome event is per-configuration (one welcome per save), so
// the lookup is by the per-user id, not the bot service id.
func findConfig(bots []repository.Bot, configID string) *repository.Bot {
	for i := range bots {
		if bots[i].ConfigID == configID {
			return &bots[i]
		}
	}
	return nil
}
