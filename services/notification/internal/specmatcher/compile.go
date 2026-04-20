package specmatcher

import (
	"fmt"
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
)

const earthRadiusKm = 6378.1

func Compile(filters []FilterSpec) (bson.M, error) {
	clauses := bson.M{}
	for _, f := range filters {
		if err := ValidateFilter(f); err != nil {
			return nil, fmt.Errorf("invalid filter: %w", err)
		}
		if f.Op != "exists" && isEmpty(f.Value) {
			continue
		}
		clause, err := compileOne(f)
		if err != nil {
			return nil, err
		}
		if clause == nil {
			continue
		}
		mergeClause(clauses, f.Field, clause)
	}
	return clauses, nil
}

func compileOne(f FilterSpec) (bson.M, error) {
	switch f.Op {
	case "exists":
		return bson.M{"$exists": true}, nil
	case "in":
		return bson.M{"$in": toSlice(f.Value, f.CI)}, nil
	case "nin":
		return bson.M{"$nin": toSlice(f.Value, f.CI)}, nil
	case "eq":
		return bson.M{"$eq": maybeLower(f.Value, f.CI)}, nil
	case "ne":
		return bson.M{"$ne": maybeLower(f.Value, f.CI)}, nil
	case "gt":
		return bson.M{"$gt": f.Value}, nil
	case "gte":
		return bson.M{"$gte": f.Value}, nil
	case "lt":
		return bson.M{"$lt": f.Value}, nil
	case "lte":
		return bson.M{"$lte": f.Value}, nil
	case "contains":
		s, ok := f.Value.(string)
		if !ok {
			return nil, fmt.Errorf("contains value must be string, got %T", f.Value)
		}
		return bson.M{"$regex": regexp.QuoteMeta(s), "$options": "i"}, nil
	case "geo_within":
		center, radiusKm, err := parseGeoValue(f.Value)
		if err != nil {
			return nil, err
		}
		return bson.M{"$geoWithin": bson.M{
			"$centerSphere": bson.A{
				bson.A{center[0], center[1]},
				radiusKm / earthRadiusKm,
			},
		}}, nil
	}
	return nil, fmt.Errorf("unsupported op %q", f.Op)
}

func parseGeoValue(v any) ([2]float64, float64, error) {
	asMapV, ok := asMap(v)
	if !ok {
		return [2]float64{}, 0, fmt.Errorf("geo_within value must be an object")
	}
	centerRaw, hasCenter := asMapV["center"]
	if !hasCenter {
		return [2]float64{}, 0, fmt.Errorf("geo_within missing `center`")
	}
	radRaw, hasRad := asMapV["radius_km"]
	if !hasRad {
		return [2]float64{}, 0, fmt.Errorf("geo_within missing `radius_km`")
	}
	pair, err := asTwoFloats(centerRaw)
	if err != nil {
		return [2]float64{}, 0, fmt.Errorf("geo_within center: %w", err)
	}
	km, ok := asNumber(radRaw)
	if !ok || km <= 0 || km > 500 {
		return [2]float64{}, 0, fmt.Errorf("geo_within radius_km must be a positive number ≤ 500")
	}
	return pair, km, nil
}

func asTwoFloats(v any) ([2]float64, error) {
	var arr []any
	switch x := v.(type) {
	case []any:
		arr = x
	case bson.A:
		arr = make([]any, len(x))
		for i, e := range x {
			arr[i] = e
		}
	case []float64:
		arr = make([]any, len(x))
		for i, e := range x {
			arr[i] = e
		}
	default:
		return [2]float64{}, fmt.Errorf("expected [lon, lat] array")
	}
	if len(arr) != 2 {
		return [2]float64{}, fmt.Errorf("expected exactly 2 numbers, got %d", len(arr))
	}
	lon, ok1 := asNumber(arr[0])
	lat, ok2 := asNumber(arr[1])
	if !ok1 || !ok2 {
		return [2]float64{}, fmt.Errorf("center values must be numbers")
	}
	if lon < -180 || lon > 180 || lat < -90 || lat > 90 {
		return [2]float64{}, fmt.Errorf("center out of range")
	}
	return [2]float64{lon, lat}, nil
}

func mergeClause(dst bson.M, field string, newOps bson.M) {
	existing, ok := dst[field].(bson.M)
	if !ok {
		dst[field] = newOps
		return
	}
	for k, v := range newOps {
		existing[k] = v
	}
}

func toSlice(val any, ci bool) bson.A {
	switch x := val.(type) {
	case []any:
		out := make(bson.A, 0, len(x))
		for _, e := range x {
			out = append(out, maybeLower(e, ci))
		}
		return out
	case bson.A:
		out := make(bson.A, 0, len(x))
		for _, e := range x {
			out = append(out, maybeLower(e, ci))
		}
		return out
	case []string:
		out := make(bson.A, 0, len(x))
		for _, e := range x {
			out = append(out, maybeLower(e, ci))
		}
		return out
	default:
		return bson.A{maybeLower(val, ci)}
	}
}

func isEmpty(v any) bool {
	if v == nil {
		return true
	}
	switch x := v.(type) {
	case string:
		return strings.TrimSpace(x) == ""
	case []any:
		return len(x) == 0
	case []string:
		return len(x) == 0
	case bson.A:
		return len(x) == 0
	}
	return false
}
