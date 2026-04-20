package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

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
	Extra        map[string]any `bson:",inline"`
}

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

const (
	BotStatusActive  = "active"
	BotStatusStopped = "stopped"
	BotStatusDeleted = "deleted"
)

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

func (b BotConfig) IsActive() bool {
	if b.ExpiresAt != nil && b.ExpiresAt.Before(time.Now()) {
		return false
	}
	return b.Status == BotStatusActive
}

type ModuleMatcher struct {
	Filters []ModuleFilterSpec `bson:"filters"`
}

type ModuleFilterSpec struct {
	Field string `bson:"field"`
	Op    string `bson:"op"`
	Value any    `bson:"value,omitempty"`
	CI    bool   `bson:"ci,omitempty"`
}

type NotificationField struct {
	Label string `bson:"label"`
	Value string `bson:"value"`
}

type NotificationSpec struct {
	Subject string              `bson:"subject"`
	Title   string              `bson:"title"`
	URL     string              `bson:"url"`
	Fields  []NotificationField `bson:"fields"`
}

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

type ScrapeEvent struct {
	RunID      string `json:"run_id"`
	Source     string `json:"source"`
	Collection string `json:"collection"`
}

type BotCreatedEvent struct {
	UserID    string    `json:"user_id"`
	BotID     string    `json:"bot_id"`
	CreatedAt time.Time `json:"created_at"`
}

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

type ResolvedRow struct {
	Title  string
	URL    string
	Fields []NotificationField
}

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
