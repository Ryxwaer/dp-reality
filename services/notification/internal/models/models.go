package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// Listing is a single scraped record. `RunID` is stamped by the
// scraper via $setOnInsert: listings only carry the run_id of the
// very first run that inserted them, so `find({run_id: X})` is the
// authoritative set of "truly new in run X".
type Listing struct {
	ID           bson.ObjectID `bson:"_id,omitempty"`
	Source       string        `bson:"source"`
	SourceID     string        `bson:"source_id"`
	RunID        string        `bson:"run_id"`
	Title        string        `bson:"title"`
	Price        *int64        `bson:"price"`
	PriceType    string        `bson:"price_type"`
	PropertyType string        `bson:"property_type"`
	Disposition  *string       `bson:"disposition"`
	City         *string       `bson:"city"`
	URL          string        `bson:"url"`
	FirstSeen    time.Time     `bson:"first_seen"`
	LastSeen     time.Time     `bson:"last_seen"`
	// Extra carries any field on the listing not called out above.
	// Populated by the BSON decoder via `bson:",inline"`; the consumer
	// merges it with the typed fields when passing the doc to the
	// notification-spec resolver so authors can reference any field
	// that exists in the collection (not just the real-estate ones).
	Extra map[string]any `bson:",inline"`
}

// AsDoc returns a flat map of the listing's fields keyed by their BSON
// field names. Used as input to the notification-spec resolver.
func (l Listing) AsDoc() map[string]any {
	doc := make(map[string]any, len(l.Extra)+16)
	for k, v := range l.Extra {
		doc[k] = v
	}
	doc["source"] = l.Source
	doc["source_id"] = l.SourceID
	doc["run_id"] = l.RunID
	doc["title"] = l.Title
	if l.Price != nil {
		doc["price"] = *l.Price
	}
	doc["price_type"] = l.PriceType
	doc["property_type"] = l.PropertyType
	if l.Disposition != nil {
		doc["disposition"] = *l.Disposition
	}
	if l.City != nil {
		doc["city"] = *l.City
	}
	doc["url"] = l.URL
	return doc
}

// Bot lifecycle status. Mirrors `BotStatus` in the frontend.
//   - active:  running, contributes to matching, emails if
//     EmailNotifications is true.
//   - stopped: user paused; no matching, no emails.
//   - deleted: soft-delete tombstone. Skipped by every active read
//     path but kept so historical notifications still resolve the
//     bot's name.
const (
	BotStatusActive  = "active"
	BotStatusStopped = "stopped"
	BotStatusDeleted = "deleted"
)

// BotConfig mirrors one entry in `users.bots[]`. Everything the
// notifier needs at run time is snapshotted here:
//
//   - Source / Collection: lets the consumer prefilter per scrape
//     event without a module join.
//   - Matcher: the compiled filter spec the module's .mjs produced
//     from the user's Config at save time. Values are already inlined;
//     the notifier just passes it to specmatcher.Compile to get a
//     native Mongo filter.
//   - Notification: the notification-spec copied from the parent
//     module at bot-create time. A later module update does not
//     retroactively change how an existing bot notifies.
//
// Config is kept on the bot only so the frontend can re-hydrate the
// module UI when the user re-opens the edit page; the notifier never
// reads it.
type BotConfig struct {
	ID                 string           `bson:"id"`
	ModuleID           string           `bson:"module_id"`
	Name               string           `bson:"name"`
	Status             string           `bson:"status"`
	EmailNotifications bool             `bson:"email_notifications"`
	Source             string           `bson:"source"`
	Collection         string           `bson:"collection"`
	ExpiresAt          *time.Time       `bson:"expires_at"`
	Config             map[string]any   `bson:"config"`
	Matcher            ModuleMatcher    `bson:"matcher"`
	Notification       NotificationSpec `bson:"notification"`
}

// IsActive reports whether this bot should participate in matching.
func (b BotConfig) IsActive() bool {
	if b.ExpiresAt != nil && b.ExpiresAt.Before(time.Now()) {
		return false
	}
	return b.Status == BotStatusActive
}

// ModuleMatcher mirrors the Zod-validated matcher spec written by the
// frontend. Represented here as a generic slice of filter specs so the
// specmatcher package owns the whitelist + shape enforcement.
type ModuleMatcher struct {
	Filters []ModuleFilterSpec `bson:"filters"`
}

// ModuleFilterSpec mirrors `shared/types.ts#ModuleFilterSpec`. Values
// are concrete at run time — there is no `from` indirection into
// bot.config any more; the module's .mjs resolved the user config into
// the literal below at save time.
type ModuleFilterSpec struct {
	Field string `bson:"field"`
	Op    string `bson:"op"`
	Value any    `bson:"value,omitempty"`
	CI    bool   `bson:"ci,omitempty"`
}

// NotificationField is one labeled row under the title in a rendered
// notification. `Value` is either a bare field name on the listing
// doc ("city") or a simple composite template ("{{ price }} CZK
// {{ price_type }}"). The resolver handles both.
type NotificationField struct {
	Label string `bson:"label"`
	Value string `bson:"value"`
}

// NotificationSpec tells the notification service which listing fields
// to surface and in what order. The notification service owns the HTML
// chrome; modules only name the fields.
type NotificationSpec struct {
	Subject string              `bson:"subject"`
	Title   string              `bson:"title"`
	URL     string              `bson:"url"`
	Fields  []NotificationField `bson:"fields"`
}

// Module is the subset of the `modules` collection this service cares
// about. The bot carries its own snapshots of matcher/notification so
// the hot path never reads this struct; it's kept for admin-side tools
// and future backfills.
type Module struct {
	ID         bson.ObjectID `bson:"_id"`
	Name       string        `bson:"name"`
	Source     string        `bson:"source"`
	Collection string        `bson:"collection"`
}

type User struct {
	ID               bson.ObjectID `bson:"_id"`
	Email            string        `bson:"email"`
	UnsubscribeToken string        `bson:"unsubscribe_token"`
	Bots             []BotConfig   `bson:"bots"`
}

// ScrapeEvent is the envelope published by every scraper when a run
// finishes with at least one newly-inserted listing. The consumer
// queries `db[Collection].find({run_id: RunID})` to fetch exactly the
// fresh rows.
type ScrapeEvent struct {
	RunID      string `json:"run_id"`
	Source     string `json:"source"`
	Collection string `json:"collection"`
}

// BotCreatedEvent is published by the frontend when a user creates a new bot
// (via POST /api/bots). We use it to trigger a one-off initial digest email
// so the user sees value immediately instead of waiting for the next scrape.
type BotCreatedEvent struct {
	UserID    string    `json:"user_id"`
	BotID     string    `json:"bot_id"`
	CreatedAt time.Time `json:"created_at"`
}

// Notification is one row of the `notifications` collection read by
// the web app's inbox. Stores the resolved slot values at match time
// (not pre-rendered HTML) so the inbox shows what the user got
// emailed even if the upstream listing later mutates.
//
// The unique index on (user_id, source, source_id) is retained as a
// safety net against double-inserts, but it is no longer queried
// during ingestion — the scraper's $setOnInsert(run_id) is the
// authoritative dedup boundary.
type Notification struct {
	ID        bson.ObjectID       `bson:"_id,omitempty"`
	UserID    bson.ObjectID       `bson:"user_id"`
	BotID     string              `bson:"bot_id"`
	ListingID bson.ObjectID       `bson:"listing_id,omitempty"`
	Source    string              `bson:"source"`
	SourceID  string              `bson:"source_id"`
	RunID     string              `bson:"run_id"`
	Title     string              `bson:"title"`
	URL       string              `bson:"url"`
	Fields    []NotificationField `bson:"fields,omitempty"`
	MatchedAt time.Time           `bson:"matched_at"`
	Unread    bool                `bson:"unread"`
}

// ResolvedRow is the output of applying a NotificationSpec to a
// listing doc. Title and URL are non-empty when the row should be
// sent; Fields only contains entries whose Value resolved to
// something non-empty.
type ResolvedRow struct {
	Title  string
	URL    string
	Fields []NotificationField
}

// NotificationFromResolved builds a Notification row from a resolved
// snapshot. `now` is captured by the caller so a whole batch shares
// one timestamp.
func NotificationFromResolved(
	userID bson.ObjectID,
	botID string,
	l Listing,
	runID string,
	r ResolvedRow,
	now time.Time,
) Notification {
	return Notification{
		UserID:    userID,
		BotID:     botID,
		ListingID: l.ID,
		Source:    l.Source,
		SourceID:  l.SourceID,
		RunID:     runID,
		Title:     r.Title,
		URL:       r.URL,
		Fields:    r.Fields,
		MatchedAt: now,
		Unread:    true,
	}
}
