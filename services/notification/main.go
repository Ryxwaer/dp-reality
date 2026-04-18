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

	"dp-reality/notification/internal/config"
	"dp-reality/notification/internal/consumer"
	"dp-reality/notification/internal/repository"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	cfg := config.Load()

	mongoClient, err := mongo.Connect(options.Client().ApplyURI(cfg.MongoURI))
	if err != nil {
		slog.Error("failed to connect to MongoDB", "err", err)
		os.Exit(1)
	}
	defer mongoClient.Disconnect(context.Background()) //nolint:errcheck

	db := mongoClient.Database(dbName(cfg.MongoURI))
	repo := repository.New(db)

	if err := repo.EnsureIndexes(context.Background()); err != nil {
		slog.Warn("failed to ensure indexes", "err", err)
	}

	amqpConn, err := amqp.Dial(cfg.RabbitMQURL)
	if err != nil {
		slog.Error("failed to connect to RabbitMQ", "err", err)
		os.Exit(1)
	}
	defer amqpConn.Close()

	slog.Info("connected to MongoDB and RabbitMQ")

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	if err := consumer.Start(ctx, amqpConn, repo, cfg); err != nil {
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
