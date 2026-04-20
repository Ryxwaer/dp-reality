package specmatcher

import (
	"math"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"

	"dp-reality/notification/internal/models"
)

func Evaluate(filters []FilterSpec, l models.Listing) bool {
	doc := l.AsDoc()
	for _, f := range filters {
		if err := ValidateFilter(f); err != nil {
			return false
		}
		if f.Op != "exists" && isEmpty(f.Value) {
			continue
		}
		if !evaluateOne(f, doc) {
			return false
		}
	}
	return true
}

func evaluateOne(f FilterSpec, doc map[string]any) bool {
	listingVal, listingOk := lookupPath(doc, f.Field)

	switch f.Op {
	case "exists":
		return listingOk && listingVal != nil
	case "in":
		return listingOk && containsAny(f.Value, listingVal, f.CI)
	case "nin":
		if !listingOk {
			return true
		}
		return !containsAny(f.Value, listingVal, f.CI)
	case "eq":
		return listingOk && equals(f.Value, listingVal, f.CI)
	case "ne":
		if !listingOk {
			return true
		}
		return !equals(f.Value, listingVal, f.CI)
	case "gt", "gte", "lt", "lte":
		if !listingOk {
			return false
		}
		return compareOrder(f.Value, listingVal, f.Op)
	case "contains":
		needle, needleOk := asString(f.Value)
		if !needleOk || needle == "" {
			return false
		}
		hay, hayOk := asString(listingVal)
		if !hayOk {
			return false
		}
		return strings.Contains(strings.ToLower(hay), strings.ToLower(needle))
	case "geo_within":
		center, radiusKm, err := parseGeoValue(f.Value)
		if err != nil {
			return false
		}
		pt, ok := pointFromDoc(listingVal)
		if !ok {
			return false
		}
		return haversineKm(center, pt) <= radiusKm
	}
	return false
}

func pointFromDoc(v any) ([2]float64, bool) {
	if m, ok := asMap(v); ok {
		coords, hasCoords := m["coordinates"]
		if hasCoords {
			if p, err := asTwoFloats(coords); err == nil {
				return p, true
			}
		}
	}
	if p, err := asTwoFloats(v); err == nil {
		return p, true
	}
	return [2]float64{}, false
}

func haversineKm(a, b [2]float64) float64 {
	toRad := func(d float64) float64 { return d * math.Pi / 180 }
	lat1, lat2 := toRad(a[1]), toRad(b[1])
	dLat := lat2 - lat1
	dLon := toRad(b[0] - a[0])
	sdLat := math.Sin(dLat / 2)
	sdLon := math.Sin(dLon / 2)
	h := sdLat*sdLat + math.Cos(lat1)*math.Cos(lat2)*sdLon*sdLon
	return 2 * earthRadiusKm * math.Asin(math.Sqrt(h))
}

func lookupPath(doc map[string]any, path string) (any, bool) {
	if path == "" {
		return nil, false
	}
	var cur any = doc
	start := 0
	for i := 0; i <= len(path); i++ {
		if i < len(path) && path[i] != '.' {
			continue
		}
		segment := path[start:i]
		start = i + 1
		m, ok := asMap(cur)
		if !ok {
			return nil, false
		}
		next, present := m[segment]
		if !present {
			return nil, false
		}
		cur = next
	}
	if cur == nil {
		return nil, false
	}
	return cur, true
}

func asMap(v any) (map[string]any, bool) {
	switch x := v.(type) {
	case map[string]any:
		return x, true
	case bson.M:
		return map[string]any(x), true
	case bson.D:
		out := make(map[string]any, len(x))
		for _, e := range x {
			out[e.Key] = e.Value
		}
		return out, true
	}
	return nil, false
}

func containsAny(expected any, actual any, ci bool) bool {
	switch x := expected.(type) {
	case []any:
		for _, e := range x {
			if equals(e, actual, ci) {
				return true
			}
		}
		return false
	case []string:
		for _, e := range x {
			if equals(e, actual, ci) {
				return true
			}
		}
		return false
	case bson.A:
		for _, e := range x {
			if equals(e, actual, ci) {
				return true
			}
		}
		return false
	default:
		return equals(expected, actual, ci)
	}
}

func equals(a, b any, ci bool) bool {
	sa, aStr := asString(a)
	sb, bStr := asString(b)
	if aStr && bStr {
		if ci {
			return strings.EqualFold(sa, sb)
		}
		return sa == sb
	}

	na, aNum := asNumber(a)
	nb, bNum := asNumber(b)
	if aNum && bNum {
		return na == nb
	}
	return a == b
}

func compareOrder(filterVal, listingVal any, op string) bool {
	if na, aOk := asNumber(listingVal); aOk {
		if nb, bOk := asNumber(filterVal); bOk {
			switch op {
			case "gt":
				return na > nb
			case "gte":
				return na >= nb
			case "lt":
				return na < nb
			case "lte":
				return na <= nb
			}
		}
	}
	if ta, aOk := listingVal.(time.Time); aOk {
		if tb, bOk := filterVal.(time.Time); bOk {
			switch op {
			case "gt":
				return ta.After(tb)
			case "gte":
				return !ta.Before(tb)
			case "lt":
				return ta.Before(tb)
			case "lte":
				return !ta.After(tb)
			}
		}
	}
	return false
}

func asString(v any) (string, bool) {
	switch x := v.(type) {
	case string:
		return x, true
	}
	return "", false
}

func asNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case int:
		return float64(x), true
	case int32:
		return float64(x), true
	case int64:
		return float64(x), true
	case float32:
		return float64(x), true
	case float64:
		return x, true
	}
	return 0, false
}

func maybeLower(v any, ci bool) any {
	if !ci {
		return v
	}
	if s, ok := v.(string); ok {
		return strings.ToLower(s)
	}
	return v
}
