package emailer

import (
	"bytes"
	"fmt"
	"html"
	"log/slog"
	"net/smtp"
	"net/url"
	"strings"

	"dp-reality/notification/internal/config"
	"dp-reality/notification/internal/models"
	"dp-reality/notification/internal/notify"
	"dp-reality/notification/internal/unsubscribe"
)

func renderRow(r models.ResolvedRow) string {
	var fields strings.Builder
	for _, f := range r.Fields {
		fmt.Fprintf(&fields,
			`<div style="color:#7f8c8d;font-size:13px;margin-top:4px"><strong>%s:</strong> %s</div>`,
			html.EscapeString(f.Label), f.Value)
	}
	return fmt.Sprintf(`<div style="padding:12px;margin-bottom:8px;border:1px solid #e0e0e0;border-radius:8px;font-family:Arial,sans-serif">
  <a href="%s" style="color:#2c3e50;font-weight:600;font-size:15px;text-decoration:none" target="_blank">%s</a>
  %s
</div>`, html.EscapeString(r.URL), r.Title, fields.String())
}

func renderRowsHTML(rows []models.ResolvedRow) string {
	var sb strings.Builder
	for _, r := range rows {
		sb.WriteString(renderRow(r))
	}
	return sb.String()
}

func sourceDisplay(src string) string {
	if src == "" {
		return "Unknown"
	}
	return strings.ToUpper(src[:1]) + src[1:]
}

func buildUnsubscribeURL(cfg config.Config, user models.User, src string) (string, error) {
	if cfg.UnsubscribeSecret == "" {
		return "", nil
	}
	tok, err := unsubscribe.Sign(cfg.UnsubscribeSecret, unsubscribe.Payload{
		UID: user.ID.Hex(),
		Src: src,
	})
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(cfg.AppBaseURL, "/")
	return fmt.Sprintf("%s/unsubscribe/%s", base, url.PathEscape(tok)), nil
}

func renderHTML(heading, intro, unsubURL string, rows []models.ResolvedRow) string {
	introHTML := ""
	if intro != "" {
		introHTML = fmt.Sprintf(`<p style="margin:0 0 16px;color:#555;font-size:14px">%s</p>`,
			html.EscapeString(intro))
	}
	footerHTML := ""
	if unsubURL != "" {
		footerHTML = fmt.Sprintf(`
  <p style="margin-top:32px;font-size:12px;color:#999;border-top:1px solid #e0e0e0;padding-top:12px">
    <a href="%s" style="color:#999">Unsubscribe / manage preferences</a>
  </p>`, html.EscapeString(unsubURL))
	}
	return fmt.Sprintf(`<html>
<body style="max-width:600px;margin:auto;padding:20px;font-family:Arial,sans-serif">
  <h2 style="color:#2c3e50;border-bottom:2px solid #e0e0e0;padding-bottom:12px">%s</h2>
  %s
  %s
  %s
</body>
</html>`, html.EscapeString(heading), introHTML, renderRowsHTML(rows), footerHTML)
}

func sendMail(cfg config.Config, user models.User, subject, body string) error {
	if cfg.SMTPServer == "" {
		slog.Warn("SMTP not configured, skipping email", "user", user.Email, "subject", subject)
		return nil
	}

	auth := smtp.PlainAuth("", cfg.SMTPLogin, cfg.SMTPPassword, cfg.SMTPServer)

	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", cfg.FromEmail)
	fmt.Fprintf(&msg, "To: %s\r\n", user.Email)
	fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
	fmt.Fprintf(&msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: text/html; charset=UTF-8\r\n\r\n")
	fmt.Fprint(&msg, body)

	addr := fmt.Sprintf("%s:%d", cfg.SMTPServer, cfg.SMTPPort)
	if err := smtp.SendMail(addr, auth, cfg.FromEmail, []string{user.Email}, msg.Bytes()); err != nil {
		return fmt.Errorf("smtp sendmail: %w", err)
	}
	return nil
}

func SendDigest(
	cfg config.Config,
	user models.User,
	src string,
	spec models.NotificationSpec,
	rows []models.ResolvedRow,
) error {
	disp := sourceDisplay(src)
	subject := notify.ResolveSubject(spec, len(rows))
	if strings.TrimSpace(spec.Subject) == "" {
		subject = fmt.Sprintf("New from %s — %d", disp, len(rows))
	}
	heading := fmt.Sprintf("New from %s (%d)", disp, len(rows))
	unsubURL, err := buildUnsubscribeURL(cfg, user, src)
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}
	body := renderHTML(heading, "", unsubURL, rows)
	if err := sendMail(cfg, user, subject, body); err != nil {
		return err
	}
	slog.Info("email sent", "kind", "digest", "user", user.Email, "source", src, "rows", len(rows))
	return nil
}

func SendInitialDigest(cfg config.Config, user models.User, bot models.BotConfig, src string, rows []models.ResolvedRow) error {
	botName := html.EscapeString(bot.Name)

	var subject, heading, intro, body string
	unsubURL, err := buildUnsubscribeURL(cfg, user, src)
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}

	if len(rows) == 0 {
		subject = fmt.Sprintf("Bot \"%s\" is active", bot.Name)
		heading = fmt.Sprintf("Bot \"%s\" is active", botName)
		intro = "No listings matched this bot's filter in the last 24 hours. " +
			"We'll email you as soon as a new match appears."
		body = renderHTML(heading, intro, unsubURL, nil)
	} else {
		subject = fmt.Sprintf("Bot \"%s\" activated — %d listings from the last 24 h", bot.Name, len(rows))
		heading = fmt.Sprintf("Bot \"%s\" activated (%d)", botName, len(rows))
		intro = "Below are the listings from the last 24 hours that match this new bot's filter. " +
			"We'll send you more as soon as the scraper finds them."
		body = renderHTML(heading, intro, unsubURL, rows)
	}

	if err := sendMail(cfg, user, subject, body); err != nil {
		return err
	}
	slog.Info("email sent", "kind", "initial_digest", "user", user.Email, "bot", bot.Name, "source", src, "rows", len(rows))
	return nil
}
