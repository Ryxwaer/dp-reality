package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver/v2/mongo/otelmongo"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/consumer"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/telemetry"
)

// Bounded startup retry parameters: absorb a RabbitMQ rollout without
// CrashLoopBackOff churn, but still fail fast if the broker is gone
// for real (per CLAUDE.md "no fallbacks that silence failure").
const (
	amqpDialTimeout  = 30 * time.Second
	amqpDialInterval = 2 * time.Second
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg := config.Load()

	rootCtx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	shutdownTelemetry, err := telemetry.Setup(rootCtx)
	if err != nil {
		slog.Error("init telemetry failed", "err", err)
		os.Exit(1)
	}
	defer func() {
		// Best-effort flush on a fresh context: rootCtx may already be
		// cancelled by the time we reach this defer.
		_ = shutdownTelemetry(context.Background())
	}()

	mongoOpts := options.Client().
		ApplyURI(cfg.MongoURI).
		SetMonitor(otelmongo.NewMonitor())
	mongoClient, err := mongo.Connect(mongoOpts)
	if err != nil {
		slog.Error("connect to MongoDB failed", "err", err)
		os.Exit(1)
	}
	defer mongoClient.Disconnect(context.Background()) //nolint:errcheck

	db := mongoClient.Database(dbName(cfg.MongoURI))
	repo := repository.New(db)

	amqpConn, err := dialRabbitMQ(rootCtx, cfg.RabbitMQURL, amqpDialTimeout, amqpDialInterval)
	if err != nil {
		slog.Error("connect to RabbitMQ failed", "err", err, "timeout", amqpDialTimeout)
		os.Exit(1)
	}
	defer amqpConn.Close()

	slog.Info("email-notifier connected", "rabbitmq", true, "mongodb", true)

	svc := consumer.New(cfg, repo)
	if err := svc.Start(rootCtx, amqpConn); err != nil && err != context.Canceled {
		slog.Error("consumer stopped", "err", err)
	}
}

// dialRabbitMQ retries amqp.Dial on a fixed interval until success,
// context cancellation, or the deadline. Each failed attempt logs at
// WARN with the attempt count; the final failure is reported by the
// caller at ERROR so the fail-fast contract is preserved.
func dialRabbitMQ(ctx context.Context, url string, timeout, interval time.Duration) (*amqp.Connection, error) {
	deadline := time.Now().Add(timeout)
	attempt := 0
	var lastErr error
	for {
		attempt++
		conn, err := amqp.Dial(url)
		if err == nil {
			if attempt > 1 {
				slog.Info("connected to RabbitMQ after retries", "attempt", attempt)
			}
			return conn, nil
		}
		lastErr = err
		if time.Now().Add(interval).After(deadline) {
			return nil, lastErr
		}
		slog.Warn("connect to RabbitMQ failed, retrying", "err", err, "attempt", attempt, "retry_in", interval)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(interval):
		}
	}
}

func dbName(uri string) string {
	if idx := strings.LastIndex(uri, "/"); idx != -1 {
		name := uri[idx+1:]
		if q := strings.Index(name, "?"); q != -1 {
			name = name[:q]
		}
		if name != "" {
			return name
		}
	}
	return "dp-reality"
}
