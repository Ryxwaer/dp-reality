// Package notify owns the notification-spec resolver.
//
// A NotificationSpec on a module lets the module author declare which
// fields of a scraped listing go into the email's named slots (title,
// url, labeled extras). The notification service owns the surrounding
// HTML chrome; this package is strictly data-to-data.
//
// The grammar is intentionally trivial:
//
//   - A bare identifier ("title") resolves to html.EscapeString(doc["title"]).
//   - An expression containing "{{ ... }}" is treated as a simple
//     substitution template: every {{ name }} is replaced with
//     html.EscapeString(doc[name]). Missing / null / empty values render
//     as "". Whitespace inside braces is tolerated. No filters, no
//     loops, no nested paths.
//
// The frontend mirrors this in services/frontend/shared/notify.ts so
// the module editor preview is byte-identical to what users receive.
package notify

import (
	"fmt"
	"html"
	"regexp"
	"strings"

	"dp-reality/notification/internal/models"
)

// placeholder matches `{{ identifier }}` inside a template string.
// Whitespace around the identifier is allowed; the identifier itself
// must start with a letter or underscore and may contain digits after.
// No dots — authors reference top-level listing fields only.
var placeholder = regexp.MustCompile(`\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}`)

// bareIdentifier reports whether an expression is a plain field name
// (e.g. "title") rather than a template. Strings wrapped in whitespace
// are still considered bare after trimming so module authors don't
// trip on a stray space.
func bareIdentifier(expr string) (string, bool) {
	trimmed := strings.TrimSpace(expr)
	if trimmed == "" {
		return "", false
	}
	for i := 0; i < len(trimmed); i++ {
		c := trimmed[i]
		if i == 0 {
			if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
				return "", false
			}
			continue
		}
		if !(c == '_' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return "", false
		}
	}
	return trimmed, true
}

// Resolve evaluates a single NotificationSpec expression against a
// listing doc. The return value is always HTML-safe.
func Resolve(expr string, doc map[string]any) string {
	if name, ok := bareIdentifier(expr); ok {
		return html.EscapeString(stringify(doc[name]))
	}
	return placeholder.ReplaceAllStringFunc(expr, func(match string) string {
		sub := placeholder.FindStringSubmatch(match)
		if len(sub) < 2 {
			return ""
		}
		return html.EscapeString(stringify(doc[sub[1]]))
	})
}

// Apply resolves every slot of a spec. If the title or URL resolves
// empty, the second return value is false and the caller should skip
// this listing — an email row with no link or heading is never useful.
func Apply(spec models.NotificationSpec, doc map[string]any) (models.ResolvedRow, bool) {
	title := strings.TrimSpace(Resolve(spec.Title, doc))
	urlVal := strings.TrimSpace(Resolve(spec.URL, doc))
	if title == "" || urlVal == "" {
		return models.ResolvedRow{}, false
	}
	fields := make([]models.NotificationField, 0, len(spec.Fields))
	for _, f := range spec.Fields {
		v := strings.TrimSpace(Resolve(f.Value, doc))
		if v == "" {
			continue
		}
		fields = append(fields, models.NotificationField{Label: f.Label, Value: v})
	}
	return models.ResolvedRow{Title: title, URL: urlVal, Fields: fields}, true
}

// ResolveSubject resolves an email subject. Unlike row slots, the
// subject also supports a virtual `{{count}}` placeholder bound to the
// number of listings in the digest. Missing keys still render as "".
func ResolveSubject(spec models.NotificationSpec, count int) string {
	ctx := map[string]any{"count": count}
	resolved := Resolve(spec.Subject, ctx)
	if strings.TrimSpace(resolved) == "" {
		return "Notification"
	}
	return resolved
}

// stringify turns the loosely-typed doc value into a display string.
// Booleans, numbers, strings and BSON primitives all have natural
// string forms; unknown types fall through `%v` which is lossy but
// safe (and only happens for very exotic scraped data).
func stringify(v any) string {
	if v == nil {
		return ""
	}
	switch x := v.(type) {
	case string:
		return x
	case bool:
		if x {
			return "true"
		}
		return "false"
	case int:
		return fmt.Sprintf("%d", x)
	case int32:
		return fmt.Sprintf("%d", x)
	case int64:
		return fmt.Sprintf("%d", x)
	case float32:
		return fmt.Sprintf("%g", x)
	case float64:
		return fmt.Sprintf("%g", x)
	}
	return fmt.Sprintf("%v", v)
}
