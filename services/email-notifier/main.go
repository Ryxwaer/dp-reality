package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"strings"
	"syscall"

	amqp "github.com/rabbitmq/amqp091-go"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.opentelemetry.io/contrib/instrumentation/go.mongodb.org/mongo-driver/v2/mongo/otelmongo"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/consumer"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/telemetry"
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

	amqpConn, err := amqp.Dial(cfg.RabbitMQURL)
	if err != nil {
		slog.Error("connect to RabbitMQ failed", "err", err)
		os.Exit(1)
	}
	defer amqpConn.Close()

	slog.Info("email-notifier connected", "rabbitmq", true, "mongodb", true)

	svc := consumer.New(cfg, repo)
	if err := svc.Start(rootCtx, amqpConn); err != nil && err != context.Canceled {
		slog.Error("consumer stopped", "err", err)
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
