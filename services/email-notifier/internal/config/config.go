// Configuration for the email-notifier service.
//
// This service has shrunk dramatically from its predecessor: it no
// longer knows about scrapers, sources, matchers, or notification
// templates. Its sole job is to consume notify.bot.processed events,
// look up the corresponding user + bot metadata in MongoDB, fetch the
// pre-rendered notification rows that the bot service appended, and
// stitch them into a single envelope email — sent immediately on
// receipt, no coalescing.
package config

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	MongoURI string

	RabbitMQURL string

	SMTPServer   string
	SMTPPort     int
	SMTPLogin    string
	SMTPPassword string
	FromEmail    string

	// Optional recipient-domain allow-list. When non-empty, sendMail
	// refuses (fail-fast) to deliver to any address whose domain is
	// not on this list. Intended for local-dev SMTP setups that can
	// only deliver to internal domains; an empty value disables the
	// check entirely so production paths through transactional relays
	// (Mailgun, etc.) are unaffected.
	AllowedRecipientDomains []string

	AppBaseURL        string
	UnsubscribeSecret string
}

func Load() Config {
	return Config{
		MongoURI:    getEnv("MONGODB_URI", ""),
		RabbitMQURL: getEnv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/"),

		SMTPServer:   getEnv("MAIL_SMTP_SERVER", ""),
		SMTPPort:     getEnvInt("MAIL_SMTP_PORT", 587),
		SMTPLogin:    getEnv("MAIL_SMTP_LOGIN", ""),
		SMTPPassword: getEnv("MAIL_SMTP_PASSWORD", ""),
		FromEmail:    getEnv("MAIL_FROM_EMAIL", ""),

		AllowedRecipientDomains: parseDomainList(getEnv("MAIL_ALLOWED_RECIPIENT_DOMAINS", "")),

		AppBaseURL:        getEnv("APP_BASE_URL", "http://localhost:3000"),
		UnsubscribeSecret: getEnv("UNSUBSCRIBE_SECRET", ""),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func parseDomainList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		d := strings.ToLower(strings.TrimSpace(p))
		if d != "" {
			out = append(out, d)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
