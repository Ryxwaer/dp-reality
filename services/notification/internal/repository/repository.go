package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"

	"dp-reality/notification/internal/models"
)

const (
	usersCol         = "users"
	notificationsCol = "notifications"
)

func validCollectionName(name string) bool {
	if name == "" || len(name) > 63 {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if i == 0 {
			if !(c >= 'a' && c <= 'z') {
				return false
			}
			continue
		}
		if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

const errDuplicateKey = 11000

type Repository struct {
	db *mongo.Database
}

func New(db *mongo.Database) *Repository {
	return &Repository{db: db}
}

func (r *Repository) EnsureIndexes(ctx context.Context) error {
	_, err := r.db.Collection(notificationsCol).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "source", Value: 1},
				{Key: "source_id", Value: 1},
			},
			Options: options.Index().SetUnique(true).SetName("user_listing_unique"),
		},
		{
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "matched_at", Value: -1},
			},
			Options: options.Index().SetName("user_recent"),
		},
		{
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "unread", Value: 1},
			},
			Options: options.Index().SetName("user_unread"),
		},
	})
	return err
}

func (r *Repository) FetchActiveUsersForScope(ctx context.Context, source, collection string) ([]models.User, error) {
	cursor, err := r.db.Collection(usersCol).Find(ctx,
		bson.D{{Key: "bots", Value: bson.D{{Key: "$elemMatch", Value: bson.D{
			{Key: "status", Value: models.BotStatusActive},
			{Key: "source", Value: source},
			{Key: "collection", Value: collection},
		}}}}},
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var users []models.User
	return users, cursor.All(ctx, &users)
}

func (r *Repository) FetchUserByID(ctx context.Context, hex string) (*models.User, error) {
	oid, err := bson.ObjectIDFromHex(hex)
	if err != nil {
		return nil, err
	}
	var user models.User
	if err := r.db.Collection(usersCol).FindOne(ctx, bson.D{{Key: "_id", Value: oid}}).Decode(&user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) FindBotMatches(ctx context.Context, collection, runID string, extraFilter bson.M) ([]models.Listing, error) {
	if !validCollectionName(collection) {
		return nil, fmt.Errorf("refusing to query invalid collection name %q", collection)
	}
	filter := bson.M{"run_id": runID}
	for k, v := range extraFilter {
		if _, clash := filter[k]; clash {
			return nil, fmt.Errorf("matcher clashes with reserved key %q", k)
		}
		filter[k] = v
	}
	cursor, err := r.db.Collection(collection).Find(ctx, filter,
		options.Find().SetSort(bson.D{{Key: "first_seen", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var listings []models.Listing
	return listings, cursor.All(ctx, &listings)
}

func (r *Repository) FetchListingsBetween(ctx context.Context, collection string, start, end time.Time) ([]models.Listing, error) {
	if !validCollectionName(collection) {
		return nil, fmt.Errorf("refusing to query invalid collection name %q", collection)
	}
	cursor, err := r.db.Collection(collection).Find(ctx,
		bson.D{{Key: "first_seen", Value: bson.D{
			{Key: "$gt", Value: start},
			{Key: "$lte", Value: end},
		}}},
		options.Find().SetSort(bson.D{{Key: "first_seen", Value: 1}}),
	)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)
	var listings []models.Listing
	return listings, cursor.All(ctx, &listings)
}

func (r *Repository) InsertNotifications(
	ctx context.Context,
	userID bson.ObjectID,
	rows []models.Notification,
) ([]models.Notification, error) {
	if len(rows) == 0 {
		return nil, nil
	}

	docs := make([]any, len(rows))
	for i := range rows {
		rows[i].UserID = userID
		docs[i] = rows[i]
	}

	_, insErr := r.db.Collection(notificationsCol).
		InsertMany(ctx, docs, options.InsertMany().SetOrdered(false))

	dupIndices := map[int]struct{}{}
	if insErr != nil {
		var bulkErr mongo.BulkWriteException
		if !errors.As(insErr, &bulkErr) {
			return nil, fmt.Errorf("insert notifications: %w", insErr)
		}
		for _, we := range bulkErr.WriteErrors {
			if we.Code != errDuplicateKey {
				return nil, fmt.Errorf("insert notifications: %w", insErr)
			}
			dupIndices[we.Index] = struct{}{}
		}
	}

	survivors := make([]models.Notification, 0, len(rows)-len(dupIndices))
	for i, row := range rows {
		if _, dup := dupIndices[i]; dup {
			continue
		}
		survivors = append(survivors, row)
	}
	return survivors, nil
}

func (r *Repository) DeleteUserNotifications(ctx context.Context, userID bson.ObjectID) error {
	if _, err := r.db.Collection(notificationsCol).DeleteMany(ctx,
		bson.D{{Key: "user_id", Value: userID}},
	); err != nil {
		return fmt.Errorf("delete notifications: %w", err)
	}
	return nil
}
