// Package specmatcher compiles the declarative matcher spec into a Mongo
// filter and evaluates it against in-memory listings.
package specmatcher

import (
	"fmt"

	"dp-reality/notification/internal/models"
)

type FilterSpec = models.ModuleFilterSpec
type Matcher = models.ModuleMatcher

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

const maxFieldDepth = 4

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
