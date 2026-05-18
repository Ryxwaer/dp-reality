package consumer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	"dp-reality/email-notifier/internal/emailer"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/telemetry"
)

const (
	welcomeExchangeName = "notify.bot.welcome"
	welcomeQueueName    = "email-notifier.bot.welcome"
)

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
	ctx = telemetry.ExtractAMQP(ctx, msg.Headers)
	ctx, span := telemetry.Tracer().Start(ctx, "notify.bot.welcome receive",
		trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "rabbitmq"),
			attribute.String("messaging.destination.name", welcomeExchangeName),
			attribute.String("messaging.operation", "receive"),
		))
	defer span.End()

	var ev WelcomeEvent
	if err := json.Unmarshal(msg.Body, &ev); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "malformed event")
		slog.Warn("welcome: dropping malformed event", "err", err)
		_ = msg.Nack(false, false)
		return
	}
	if ev.UserID == "" || ev.ConfigID == "" || ev.HTML == "" {
		span.SetStatus(codes.Error, "missing fields")
		slog.Warn("welcome: dropping event with missing fields",
			"user_id", ev.UserID, "config_id", ev.ConfigID,
			"bot_id", ev.BotID, "html_len", len(ev.HTML))
		_ = msg.Nack(false, false)
		return
	}

	span.SetAttributes(
		attribute.String("user.id", ev.UserID),
		attribute.String("bot.id", ev.BotID),
		attribute.String("config.id", ev.ConfigID),
	)

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
		slog.Info("welcome: config no longer present on user, skipping",
			"user_id", ev.UserID, "config_id", ev.ConfigID)
		_ = msg.Ack(false)
		return
	}
	if !bot.EmailNotifications || (bot.Status != "active" && bot.Status != "pending") {
		slog.Debug("welcome: bot opted out or inactive, skipping",
			"user_id", ev.UserID, "config_id", ev.ConfigID,
			"status", bot.Status, "email", bot.EmailNotifications)
		_ = msg.Ack(false)
		return
	}

	if err := emailer.SendWelcome(s.cfg, *user, ev.BotID, ev.Subject, ev.HTML); err != nil {
		slog.Warn("welcome: send failed, dropping (no retry)",
			"user_id", ev.UserID, "config_id", ev.ConfigID, "err", err)
		_ = msg.Ack(false)
		return
	}

	slog.Info("welcome sent",
		"user", user.Email, "config_id", ev.ConfigID, "bot_id", ev.BotID)
	_ = msg.Ack(false)
}

func findConfig(bots []repository.Bot, configID string) *repository.Bot {
	for i := range bots {
		if bots[i].ConfigID == configID {
			return &bots[i]
		}
	}
	return nil
}
