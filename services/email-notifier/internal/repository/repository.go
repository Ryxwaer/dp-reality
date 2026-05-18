package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const (
	usersCol         = "users"
	notificationsCol = "notifications"
)

type Bot struct {
	ConfigID           string     `bson:"config_id"`
	BotID              string     `bson:"bot_id"`
	Name               string     `bson:"name"`
	Status             string     `bson:"status"`
	EmailNotifications bool       `bson:"email_notifications"`
	ExpiresAt          *time.Time `bson:"expires_at,omitempty"`
}

type User struct {
	ID    bson.ObjectID `bson:"_id"`
	Email string        `bson:"email"`
	Name  string        `bson:"name"`
	Bots  []Bot         `bson:"bots"`
}

type Notification struct {
	ID        bson.ObjectID `bson:"_id"`
	UserID    string        `bson:"user_id"`
	BotID     string        `bson:"bot_id"`
	ConfigIDs []string      `bson:"config_ids"`
	SourceRef string        `bson:"source_ref"`
	Title     string        `bson:"title"`
	URL       string        `bson:"url"`
	HTML      string        `bson:"html"`
	CreatedAt time.Time     `bson:"created_at"`
	Unread    bool          `bson:"unread"`
	SentAt    *time.Time    `bson:"sent_at"`
}

type Repository struct {
	db *mongo.Database
}

func New(db *mongo.Database) *Repository {
	return &Repository{db: db}
}

func (r *Repository) FetchUser(ctx context.Context, userID string) (*User, error) {
	oid, err := bson.ObjectIDFromHex(userID)
	if err != nil {
		return nil, fmt.Errorf("invalid user id %q: %w", userID, err)
	}
	var u User
	if err := r.db.Collection(usersCol).FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

// FetchUnsentForBot returns unsent notifications for the user/bot, sorted oldest-first.
func (r *Repository) FetchUnsentForBot(ctx context.Context, userID, botID string) ([]Notification, error) {
	cursor, err := r.db.Collection(notificationsCol).Find(ctx,
		bson.D{
			{Key: "user_id", Value: userID},
			{Key: "bot_id", Value: botID},
			{Key: "sent_at", Value: nil},
		},
		options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var rows []Notification
	if err := cursor.All(ctx, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

func (r *Repository) MarkSent(ctx context.Context, ids []bson.ObjectID, when time.Time) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := r.db.Collection(notificationsCol).UpdateMany(ctx,
		bson.D{{Key: "_id", Value: bson.D{{Key: "$in", Value: ids}}}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "sent_at", Value: when}}}},
	)
	if err != nil {
		return fmt.Errorf("mark sent: %w", err)
	}
	return nil
}

func IsNotFound(err error) bool {
	return errors.Is(err, mongo.ErrNoDocuments)
}
