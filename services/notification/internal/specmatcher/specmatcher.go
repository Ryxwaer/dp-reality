// Package specmatcher compiles the declarative matcher spec that each
// bot carries (snapshotted from the module's .mjs at save time) into a
// concrete Mongo filter, and evaluates the same spec against an
// in-memory listing. The spec is pure data — a whitelist of operators
// and a safe dotted-path pattern — so there is no way a buggy module
// can smuggle `$where`, `$regex`, `$expr`, `_id` lookups, or any other
// Mongo operator through it.
//
// Values are concrete: the frontend's MATCHER_SCHEMA rejects anything
// that isn't a primitive or an array of primitives, and the module's
// .mjs is responsible for inlining the user's `config` before calling
// `saveBot`. The notifier never has to look at `bot.Config` again.
//
// Two entry points:
//
//   - Compile: turns a list of filters into a bson.M filter you can
//     AND with `{run_id}` and hand to collection.Find.
//   - Evaluate: evaluates the same filters against a fully-decoded
//     in-memory listing, used for flows that don't go through the DB
//     (bot.created initial digest).
package specmatcher

import (
	"fmt"

	"dp-reality/notification/internal/models"
)

// FilterSpec and Matcher are re-exports of the corresponding `models`
// types. Kept as aliases so call sites that already import specmatcher
// don't need to also import models just for the shape.
type FilterSpec = models.ModuleFilterSpec
type Matcher = models.ModuleMatcher

// Operators are whitelisted — this is what keeps `$where`, `$regex`,
// `$expr`, and every other eval-capable operator out of the matcher.
// Any drift from the frontend Zod schema (`server/utils/module-matcher.ts`)
// is a bug; this list must remain a superset of what the API accepts.
var allowedOps = map[string]struct{}{
	"in":         {},
	"nin":        {},
	"eq":         {},
	"ne":         {},
	"exists":     {},
	"gt":         {},
	"gte":        {},
	"lt":         {},
	"lte":        {},
	"contains":   {},
	"geo_within": {},
}

// maxFieldDepth limits how deep a dotted-path `Field` can reach. Keeps
// the path walker bounded regardless of the frontend; the zod schema
// enforces the same cap. 4 segments covers realistic author needs
// (`meta.tags.primary`) without opening a door to recursive shapes.
const maxFieldDepth = 4

// ValidateFilter enforces the shape of a single filter spec.
//
// Field names are validated against a safe pattern (see validFieldPath)
// rather than a fixed whitelist: modules can target arbitrary
// collections, so the set of legitimate field names isn't knowable
// here. What we do guarantee is that nothing that could be interpreted
// as a Mongo operator (`$…`) or array subscript (`x[0]`) gets through
// — combined with the op whitelist, that's enough to prevent injection.
func ValidateFilter(f FilterSpec) error {
	if !validFieldPath(f.Field) {
		return fmt.Errorf("field %q is not a valid identifier path", f.Field)
	}
	if _, ok := allowedOps[f.Op]; !ok {
		return fmt.Errorf("op %q not in whitelist", f.Op)
	}
	if f.Op != "exists" && f.Value == nil {
		return fmt.Errorf("filter on %q needs `value`", f.Field)
	}
	// `ci` is accepted on both symbolic-equality and `contains` ops.
	// `geo_within` and range ops have no text to fold.
	if f.CI && f.Op != "in" && f.Op != "nin" && f.Op != "eq" && f.Op != "ne" && f.Op != "contains" {
		return fmt.Errorf("ci only applies to in/nin/eq/ne/contains (got %q)", f.Op)
	}
	if f.Op == "contains" {
		s, ok := f.Value.(string)
		if !ok || s == "" {
			return fmt.Errorf("contains filter on %q needs a non-empty string value", f.Field)
		}
	}
	return nil
}

// validFieldPath enforces the frontend pattern
// `^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,3}$` without a
// regex dependency. Dotted segments are allowed so modules can target
// nested fields (`meta.tags`); `$`, `[`, `]`, spaces, and leading
// digits are rejected.
func validFieldPath(p string) bool {
	if p == "" || len(p) > 128 {
		return false
	}
	segmentStart := true
	segments := 1
	for i := 0; i < len(p); i++ {
		c := p[i]
		if c == '.' {
			if segmentStart {
				return false
			}
			segments++
			if segments > maxFieldDepth {
				return false
			}
			segmentStart = true
			continue
		}
		if segmentStart {
			if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
				return false
			}
			segmentStart = false
			continue
		}
		if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return !segmentStart
}
