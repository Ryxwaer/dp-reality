package emailer

import (
	"bytes"
	"fmt"
	"html"
	"log/slog"
	"mime"
	"mime/quotedprintable"
	"net/smtp"
	"net/url"
	"strings"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/unsubscribe"
)

func envelope(heading, intro, unsubURL, cardsHTML string) string {
	introHTML := ""
	if intro != "" {
		introHTML = fmt.Sprintf(
			`<p style="margin:0 0 16px;color:#475569;font-size:14px">%s</p>`,
			html.EscapeString(intro),
		)
	}
	footerHTML := ""
	if unsubURL != "" {
		footerHTML = fmt.Sprintf(`
  <p style="margin-top:32px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">
    <a href="%s" style="color:#94a3b8">Unsubscribe / manage your bots</a>
  </p>`, html.EscapeString(unsubURL))
	}
	return fmt.Sprintf(`<html>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
  <meta name="color-scheme" content="only light">
  <meta name="supported-color-schemes" content="only light">
</head>
<body style="max-width:600px;margin:auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a">
  <h2 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin:0 0 16px">%s</h2>
  %s
  %s
  %s
</body>
</html>`, html.EscapeString(heading), introHTML, cardsHTML, footerHTML)
}

func buildUnsubscribeURL(cfg config.Config, userID, botID string) (string, error) {
	if cfg.UnsubscribeSecret == "" {
		return "", nil
	}
	tok, err := unsubscribe.Sign(cfg.UnsubscribeSecret, unsubscribe.Payload{
		UID: userID,
		BID: botID,
	})
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(cfg.AppBaseURL, "/")
	return fmt.Sprintf("%s/unsubscribe/%s", base, url.PathEscape(tok)), nil
}

func recipientDomainAllowed(allowed []string, to string) bool {
	if len(allowed) == 0 {
		return true
	}
	at := strings.LastIndexByte(to, '@')
	if at < 0 || at == len(to)-1 {
		return false
	}
	domain := strings.ToLower(to[at+1:])
	for _, d := range allowed {
		if domain == d {
			return true
		}
	}
	return false
}

func sendMail(cfg config.Config, to, subject, body string) error {
	if cfg.SMTPServer == "" {
		slog.Warn("SMTP not configured, skipping email", "to", to, "subject", subject)
		return nil
	}
	if !recipientDomainAllowed(cfg.AllowedRecipientDomains, to) {
		return fmt.Errorf("recipient %q outside allowed domains %v", to, cfg.AllowedRecipientDomains)
	}
	auth := smtp.PlainAuth("", cfg.SMTPLogin, cfg.SMTPPassword, cfg.SMTPServer)

	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", cfg.FromEmail)
	fmt.Fprintf(&msg, "To: %s\r\n", to)
	fmt.Fprintf(&msg, "Subject: %s\r\n", mime.QEncoding.Encode("utf-8", subject))
	fmt.Fprintf(&msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: text/html; charset=UTF-8\r\n")
	fmt.Fprintf(&msg, "Content-Transfer-Encoding: quoted-printable\r\n\r\n")

	qp := quotedprintable.NewWriter(&msg)
	if _, err := qp.Write([]byte(body)); err != nil {
		return fmt.Errorf("encode body: %w", err)
	}
	if err := qp.Close(); err != nil {
		return fmt.Errorf("close qp writer: %w", err)
	}

	addr := fmt.Sprintf("%s:%d", cfg.SMTPServer, cfg.SMTPPort)
	if err := smtp.SendMail(addr, auth, cfg.FromEmail, []string{to}, msg.Bytes()); err != nil {
		return fmt.Errorf("smtp sendmail: %w", err)
	}
	return nil
}

func SendDigest(cfg config.Config, user repository.User, bot repository.Bot, rows []repository.Notification) error {
	if len(rows) == 0 {
		return nil
	}
	if user.Email == "" {
		slog.Warn("user has no email, skipping", "user_id", user.ID.Hex())
		return nil
	}

	var cards strings.Builder
	for _, r := range rows {
		cards.WriteString(wrapCardLink(r.URL, r.HTML))
	}

	botLabel := bot.Name
	if botLabel == "" {
		botLabel = bot.BotID
	}
	heading := fmt.Sprintf(`%d new from "%s"`, len(rows), botLabel)
	subject := fmt.Sprintf(`%d new match%s — %s`, len(rows), plural(len(rows)), botLabel)

	unsubURL, err := buildUnsubscribeURL(cfg, user.ID.Hex(), bot.BotID)
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}

	body := envelope(heading, "", unsubURL, cards.String())
	if err := sendMail(cfg, user.Email, subject, body); err != nil {
		return err
	}
	slog.Info("digest sent",
		"user", user.Email, "bot_id", bot.BotID, "rows", len(rows))
	return nil
}

func SendWelcome(cfg config.Config, user repository.User, bot repository.Bot, sourceDisplayName, cardHTML string) error {
	if user.Email == "" {
		slog.Warn("welcome: user has no email, skipping", "user_id", user.ID.Hex())
		return nil
	}
	if cardHTML == "" {
		return nil
	}

	unsubURL, err := buildUnsubscribeURL(cfg, user.ID.Hex(), bot.BotID)
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}

	botLabel := bot.Name
	if botLabel == "" {
		botLabel = bot.BotID
	}
	source := sourceDisplayName
	if source == "" {
		source = bot.BotID
	}
	subject := fmt.Sprintf(`Your bot "%s" is now watching %s`, botLabel, source)

	body := envelope(subject, "", unsubURL, cardHTML)
	return sendMail(cfg, user.Email, subject, body)
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "es"
}

func wrapCardLink(url, cardHTML string) string {
	if url == "" {
		return cardHTML
	}
	return fmt.Sprintf(
		`<a href="%s" target="_blank" rel="noopener noreferrer" style="display:block;text-decoration:none;color:inherit">%s</a>`,
		html.EscapeString(url),
		cardHTML,
	)
}
