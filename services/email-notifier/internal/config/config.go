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
