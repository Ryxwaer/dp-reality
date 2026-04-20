// Package notify resolves module NotificationSpec templates against listing docs.
package notify

import (
	"fmt"
	"html"
	"regexp"
	"strings"

	"dp-reality/notification/internal/models"
)

var placeholder = regexp.MustCompile(`\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}`)

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

func ResolveSubject(spec models.NotificationSpec, count int) string {
	ctx := map[string]any{"count": count}
	resolved := Resolve(spec.Subject, ctx)
	if strings.TrimSpace(resolved) == "" {
		return "Notification"
	}
	return resolved
}

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
