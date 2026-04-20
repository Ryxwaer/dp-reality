package config

import (
	"os"
	"strconv"
)

type Config struct {
	MongoURI          string
	RabbitMQURL       string
	SMTPServer        string
	SMTPPort          int
	SMTPLogin         string
	SMTPPassword      string
	FromEmail         string
	AppBaseURL        string
	BatchWindowSecs   int
	UnsubscribeSecret string
}

func Load() Config {
	return Config{
		MongoURI:          getEnv("MONGODB_URI", ""),
		RabbitMQURL:       getEnv("RABBITMQ_URL", "amqp://guest:guest@rabbitmq:5672/"),
		SMTPServer:        getEnv("MAIL_SMTP_SERVER", ""),
		SMTPPort:          getEnvInt("MAIL_SMTP_PORT", 587),
		SMTPLogin:         getEnv("MAIL_SMTP_LOGIN", ""),
		SMTPPassword:      getEnv("MAIL_SMTP_PASSWORD", ""),
		FromEmail:         getEnv("MAIL_FROM_EMAIL", ""),
		AppBaseURL:        getEnv("APP_BASE_URL", "http://localhost:3000"),
		BatchWindowSecs:   getEnvInt("BATCH_WINDOW_SECONDS", 300),
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
