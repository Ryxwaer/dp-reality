package models

import (
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
)

type Listing struct {
	ID           bson.ObjectID `bson:"_id,omitempty"`
	Source       string        `bson:"source"`
	SourceID     string        `bson:"source_id"`
	Title        string        `bson:"title"`
	Price        *int64        `bson:"price"`
	PriceType    string        `bson:"price_type"`
	PropertyType string        `bson:"property_type"`
	Disposition  *string       `bson:"disposition"`
	City         *string       `bson:"city"`
	URL          string        `bson:"url"`
	FirstSeen    time.Time     `bson:"first_seen"`
	LastSeen     time.Time     `bson:"last_seen"`
}

type BotConfig struct {
	ID            string     `bson:"id"`
	Name          string     `bson:"name"`
	Cities        []string   `bson:"cities"`
	PropertyTypes []string   `bson:"property_types"`
	PriceTypes    []string   `bson:"price_types"`
	MinPrice      *int64     `bson:"min_price"`
	MaxPrice      *int64     `bson:"max_price"`
	Dispositions  []string   `bson:"dispositions"`
	Active        bool       `bson:"active"`
	ExpiresAt     *time.Time `bson:"expires_at"`
}

type User struct {
	ID               bson.ObjectID `bson:"_id"`
	Email            string        `bson:"email"`
	UnsubscribeToken string        `bson:"unsubscribe_token"`
	LastNotifiedAt   *time.Time    `bson:"last_notified_at"`
	Bots             []BotConfig   `bson:"bots"`
}

type ScrapeEvent struct {
	Source    string    `json:"source"`
	NewCount  int       `json:"new_count"`
	Timestamp time.Time `json:"timestamp"`
}
