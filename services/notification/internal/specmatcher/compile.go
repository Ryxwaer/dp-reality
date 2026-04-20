package specmatcher

import (
	"fmt"
	"regexp"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// earthRadiusKm is used to convert km → radians for $centerSphere,
// which is what Mongo needs when its index type is 2dsphere and the
// query value is pre-projected. 6378.1 is the WGS-84 equatorial
// radius in km — the 0.3% flattening error vs. a great-circle
// distance is well inside "good enough for apartment hunting".
const earthRadiusKm = 6378.1

// Compile turns a spec into a bson.M filter. Values are already
// concrete (no `from` indirection since the bot-owned matcher rework —
// the module's .mjs inlined user config at save time), so this is a
// pure shape-to-bson transformation; no bot argument is required.
//
// The returned map is intended to be AND-ed with whatever scoping the
// caller applies (run_id, source/collection prefilter on the bot query).
//
// An invalid filter is fatal for the whole compile — better to refuse
// to match than to silently weaken the query.
func Compile(filters []FilterSpec) (bson.M, error) {
	clauses := bson.M{}
	for _, f := range filters {
		if err := ValidateFilter(f); err != nil {
			return nil, fmt.Errorf("invalid filter: %w", err)
		}
		if f.Op != "exists" && isEmpty(f.Value) {
			// Drop empty-array in/nin filters so an absent config axis
			// is still "no filter on that axis". The module is expected
			// to drop these before saving; we're defensive in case a
			// buggy bundle lets one through.
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

// compileOne produces the Mongo operator document for a single filter.
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
		// Always case-insensitive. Pattern is the literal-escaped
		// user substring — we never take a raw regex from the
		// author, which keeps ReDoS and `$where`-alike foot-guns
		// off the table.
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

// parseGeoValue extracts `{ center: [lon, lat], radius_km }` from the
// generic filter value. Accepts both bson.M (what we get off the wire
// after BSON decoding) and map[string]any (what JSON decode produces
// when the matcher is fed through a non-Mongo transport); likewise
// handles bson.A / []any for the center slice. Returns the coordinate
// pair in [lon, lat] order.
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

// asTwoFloats pulls out a [lon, lat] pair from the loosely-typed
// center slice. Rejects anything that isn't exactly two numbers.
// Accepts the shapes BSON decoding or JSON decoding can produce.
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

// mergeClause merges a new operator doc into the field's existing
// clause. Needed because multiple filters can target the same field
// (e.g. price gte + price lte) and Mongo expects both operators in one
// sub-doc. Works on dotted paths too — Mongo handles the traversal on
// its side, we just use the path string as the map key verbatim.
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

// toSlice normalises a value (singular or slice) into a bson.A for
// `$in`/`$nin`. With ci: true, string entries are lowercased — the
// caller is expected to have scrapers write the listing side in lower
// case (the evaluator handles mixed case in-memory; for Mongo queries
// we do NOT generate regexes, so query-time case insensitivity is only
// effective if listings are normalised at write time).
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

// isEmpty reports whether a value counts as "no filter on this axis".
// The frontend drops these before save; we duplicate the check here
// so a buggy bundle can't silently match everything by emitting an
// empty-array `in`.
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
