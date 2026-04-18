package matcher

import (
	"strings"
	"time"

	"dp-reality/notification/internal/models"
)

func ListingKey(l models.Listing) string {
	return l.Source + ":" + l.SourceID
}

func matchesBot(l models.Listing, bot models.BotConfig) bool {
	if bot.ExpiresAt != nil && bot.ExpiresAt.Before(time.Now()) {
		return false
	}

	if len(bot.Cities) > 0 {
		city := ""
		if l.City != nil {
			city = strings.ToLower(*l.City)
		}
		found := false
		for _, c := range bot.Cities {
			if strings.ToLower(c) == city {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if len(bot.PropertyTypes) > 0 {
		found := false
		for _, pt := range bot.PropertyTypes {
			if pt == l.PropertyType {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if len(bot.PriceTypes) > 0 {
		found := false
		for _, pt := range bot.PriceTypes {
			if pt == l.PriceType {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	if bot.MinPrice != nil && (l.Price == nil || *l.Price < *bot.MinPrice) {
		return false
	}

	if bot.MaxPrice != nil && (l.Price == nil || *l.Price > *bot.MaxPrice) {
		return false
	}

	if len(bot.Dispositions) > 0 {
		disp := ""
		if l.Disposition != nil {
			disp = strings.ToLower(*l.Disposition)
		}
		found := false
		for _, d := range bot.Dispositions {
			if strings.ToLower(d) == disp {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}

	return true
}

func MatchForUser(listings []models.Listing, user models.User) []models.Listing {
	var matched []models.Listing
	seen := make(map[string]struct{})

	for _, l := range listings {
		key := ListingKey(l)
		if _, already := seen[key]; already {
			continue
		}
		for _, bot := range user.Bots {
			if bot.Active && matchesBot(l, bot) {
				matched = append(matched, l)
				seen[key] = struct{}{}
				break
			}
		}
	}
	return matched
}
