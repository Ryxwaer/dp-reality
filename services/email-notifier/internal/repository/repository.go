// MongoDB access for the email-notifier.
//
// The notifier reads from exactly two collections:
//   - users: to look up the email address, bot metadata, and the
//     per-bot email_notifications flag;
//   - notifications: to fetch the pre-rendered HTML cards that the
//     originating bot service inserted.
//
// It writes to one collection (notifications) only to stamp sent_at
// after a successful delivery.
//
// Anything specific to a source (matcher syntax, listing schema,
// notification templating) is the bot service's concern, not ours.
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

// Bot is the BFF-owned per-user configuration metadata. `ConfigID` is
// the per-user, BFF-minted identifier carried on every event from the
// bot service; `BotID` is the platform-wide service identifier (the
// compose / k8s service name) advertised in module_registry.
// `ExpiresAt` carries the visit-to-refresh expiry (FR-02-B); the
// notifier never writes it but round-trips it so any future read path
// can rely on it being present.
type Bot struct {
	ConfigID           string     `bson:"config_id"`
	BotID              string     `bson:"bot_id"`
	Name               string     `bson:"name"`
	Status             string     `bson:"status"`
	EmailNotifications bool       `bson:"email_notifications"`
	ExpiresAt          *time.Time `bson:"expires_at,omitempty"`
}

// User mirrors the BFF's users collection. Only the fields the
// notifier needs are decoded.
type User struct {
	ID    bson.ObjectID `bson:"_id"`
	Email string        `bson:"email"`
	Name  string        `bson:"name"`
	Bots  []Bot         `bson:"bots"`
}

// Notification is the row written by a bot service. We treat the
// `html` blob as opaque; matcher fields and source schemas are out of
// scope for this service. The `(user_id, bot_id, source_ref)` unique
// index collapses two matching configs of the same user/bot/listing
// into a single row; `ConfigIDs` is the audit trail of which configs
// of the user flagged the listing.
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

// FetchUser returns the user document by string-form _id. The BFF
// publishes ObjectIDs as 24-hex; legacy clients passing other formats
// get a controlled error.
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

// FetchUnsentForBot returns notifications for `userID` belonging to
// `botID` that have not yet been emailed. Sorted oldest-first so the
// envelope reads chronologically. The dedup key on the row is
// `(user_id, bot_id, source_ref)`, so a single row already covers all
// of the user's configs of that bot that matched the listing; the
// caller's per-config gating only needs to decide whether ANY of the
// user's configs of this bot is currently opted-in.
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

// MarkSent stamps sent_at on the listed notification rows. Best-effort:
// individual write errors are folded together but not propagated as
// failures (re-emailing the same row only happens if sent_at remained
// nil, which is the safe direction).
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

// IsNotFound is used to silently drop events for users that no longer
// exist (deleted accounts, etc.).
func IsNotFound(err error) bool {
	return errors.Is(err, mongo.ErrNoDocuments)
}
