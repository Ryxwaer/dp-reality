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

// validCollectionName mirrors the frontend's `COLLECTION_PATTERN`
// (`^[a-z][a-z0-9_]{0,62}$`). Guards against a compromised or buggy
// module trying to read from an unrelated collection (`users`,
// `notifications`, …) by naming it. Worst case a bad module is no-op.
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

// Duplicate-key code for MongoDB. The driver doesn't export a constant
// for this — 11000 is the documented wire code and is stable.
const errDuplicateKey = 11000

type Repository struct {
	db *mongo.Database
}

func New(db *mongo.Database) *Repository {
	return &Repository{db: db}
}

// EnsureIndexes creates the indexes this service owns. The notification
// service is the sole authority on `notifications`: the frontend just
// reads and updates `unread` flags, so all index definitions live here.
func (r *Repository) EnsureIndexes(ctx context.Context) error {
	_, err := r.db.Collection(notificationsCol).Indexes().CreateMany(ctx, []mongo.IndexModel{
		{
			// Belt-and-suspenders: even though scraper-side $setOnInsert(run_id)
			// means we should never be asked to insert the same (user, listing)
			// twice, we still enforce it here so a redelivered scrape event is a
			// no-op for the inbox.
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "source", Value: 1},
				{Key: "source_id", Value: 1},
			},
			Options: options.Index().SetUnique(true).SetName("user_listing_unique"),
		},
		{
			// Inbox listing: latest first for one user.
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "matched_at", Value: -1},
			},
			Options: options.Index().SetName("user_recent"),
		},
		{
			// Unread badge count.
			Keys: bson.D{
				{Key: "user_id", Value: 1},
				{Key: "unread", Value: 1},
			},
			Options: options.Index().SetName("user_unread"),
		},
	})
	return err
}

// FetchActiveUsersForScope returns users with at least one active bot
// whose `source` and `collection` both match the scrape event's scope.
// The `$elemMatch` ensures we only consider bots that pass all three
// conditions together — without it, a user with a stopped bazos bot and
// an active sreality bot would match a `(bazos, reality)` scope.
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

// FetchUserByID loads a single user by hex ObjectID. Returns
// mongo.ErrNoDocuments if not found.
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

// FindBotMatches streams the subset of listings in `collection` that
// match `{run_id: runID} AND extraFilter` and returns them as decoded
// Listing values. `extraFilter` is expected to come from
// specmatcher.Compile and is the per-bot matcher. The scraper's
// $setOnInsert(run_id) semantics mean re-upserted (already-known)
// listings keep their original run_id, so this query never returns a
// previously-notified listing.
//
// No Limit() cap here — the matcher is already narrow and the run_id
// index keeps it cheap. Callers are expected to iterate the returned
// slice in-memory, which is bounded by how many listings a single
// bot's filter matches in a single run.
func (r *Repository) FindBotMatches(ctx context.Context, collection, runID string, extraFilter bson.M) ([]models.Listing, error) {
	if !validCollectionName(collection) {
		return nil, fmt.Errorf("refusing to query invalid collection name %q", collection)
	}
	filter := bson.M{"run_id": runID}
	for k, v := range extraFilter {
		if _, clash := filter[k]; clash {
			// The compiled matcher must not override run_id. Defensive:
			// validFieldPath already rejects `run_id` via the regex only
			// if the module names it — we still make the conflict loud
			// rather than silently merging.
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

// FetchListingsBetween returns listings with first_seen in (start, end]
// from the given collection, sorted oldest-first. Used by the
// bot.created flow for an exact 24h window — it intentionally ignores
// run_id because a brand-new bot should see every recent listing that
// matches its filter, including ones discovered in earlier runs.
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

// InsertNotifications persists a batch of notifications for one user.
// Duplicate-key errors (one per `(user_id, source, source_id)` race)
// are swallowed — the unique index is a safety net, not a dedup
// oracle. Returns the subset of `rows` that were newly inserted,
// preserving input order so the caller can email exactly those.
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

// DeleteUserNotifications removes every inbox row for a user.
func (r *Repository) DeleteUserNotifications(ctx context.Context, userID bson.ObjectID) error {
	if _, err := r.db.Collection(notificationsCol).DeleteMany(ctx,
		bson.D{{Key: "user_id", Value: userID}},
	); err != nil {
		return fmt.Errorf("delete notifications: %w", err)
	}
	return nil
}
