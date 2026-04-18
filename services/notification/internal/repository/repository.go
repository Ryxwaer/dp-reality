package repository

import (
	"context"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"dp-reality/notification/internal/models"
)

const (
	realityCol = "reality"
	usersCol   = "users"
)

type Repository struct {
	db *mongo.Database
}

func New(db *mongo.Database) *Repository {
	return &Repository{db: db}
}

// EnsureIndexes creates the index on users.last_notified_at used for finding
// the earliest cursor across active users.
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	_, err := r.db.Collection(usersCol).Indexes().CreateOne(ctx, mongo.IndexModel{
		Keys: bson.D{{Key: "last_notified_at", Value: 1}},
	})
	return err
}

// FetchActiveUsers returns all users that have at least one active bot.
func (r *Repository) FetchActiveUsers(ctx context.Context) ([]models.User, error) {
	cursor, err := r.db.Collection(usersCol).Find(ctx,
		bson.D{{Key: "bots.active", Value: true}},
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var users []models.User
	return users, cursor.All(ctx, &users)
}

// FetchListingsSince returns listings with first_seen after the given time,
// sorted oldest-first so per-user cursor advancement is correct.
func (r *Repository) FetchListingsSince(ctx context.Context, since time.Time) ([]models.Listing, error) {
	opts := options.Find().
		SetSort(bson.D{{Key: "first_seen", Value: 1}}).
		SetLimit(5000)

	cursor, err := r.db.Collection(realityCol).Find(ctx,
		bson.D{{Key: "first_seen", Value: bson.D{{Key: "$gt", Value: since}}}},
		opts,
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var listings []models.Listing
	return listings, cursor.All(ctx, &listings)
}

// AdvanceUserCursor sets last_notified_at for one user.
func (r *Repository) AdvanceUserCursor(ctx context.Context, userID bson.ObjectID, t time.Time) error {
	_, err := r.db.Collection(usersCol).UpdateOne(ctx,
		bson.D{{Key: "_id", Value: userID}},
		bson.D{{Key: "$set", Value: bson.D{{Key: "last_notified_at", Value: t}}}},
	)
	return err
}
