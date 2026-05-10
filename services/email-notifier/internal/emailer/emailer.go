// Email envelope assembler.
//
// The bot service has already produced the per-message HTML (one
// "card" per matched listing for a digest, or a self-contained welcome
// card for a brand-new configuration). This package only stacks that
// HTML inside a generic envelope that carries:
//   - a banner with the bot name + match count;
//   - the cards verbatim, in the order the bot service wrote them;
//   - a footer with an unsubscribe link.
//
// We never inspect the card contents and never re-render them; that
// HTML is the bot service's contract with the user, not ours.
package emailer

import (
	"bytes"
	"fmt"
	"html"
	"log/slog"
	"net/smtp"
	"net/url"
	"strings"

	"dp-reality/email-notifier/internal/config"
	"dp-reality/email-notifier/internal/repository"
	"dp-reality/email-notifier/internal/unsubscribe"
)

// envelope wraps the cards in a max-600px container with a bot-aware
// banner and an unsubscribe footer.
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
<body style="max-width:600px;margin:auto;padding:20px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#0f172a">
  <h2 style="color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:12px;margin:0 0 16px">%s</h2>
  %s
  %s
  %s
</body>
</html>`, html.EscapeString(heading), introHTML, cardsHTML, footerHTML)
}

func buildUnsubscribeURL(cfg config.Config, userID string) (string, error) {
	if cfg.UnsubscribeSecret == "" {
		return "", nil
	}
	tok, err := unsubscribe.Sign(cfg.UnsubscribeSecret, unsubscribe.Payload{UID: userID})
	if err != nil {
		return "", err
	}
	base := strings.TrimRight(cfg.AppBaseURL, "/")
	return fmt.Sprintf("%s/unsubscribe/%s", base, url.PathEscape(tok)), nil
}

// recipientDomainAllowed reports whether `to`'s domain is permitted by
// the configured allow-list. An empty allow-list disables the check.
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
	fmt.Fprintf(&msg, "Subject: %s\r\n", subject)
	fmt.Fprintf(&msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: text/html; charset=UTF-8\r\n\r\n")
	fmt.Fprint(&msg, body)

	addr := fmt.Sprintf("%s:%d", cfg.SMTPServer, cfg.SMTPPort)
	if err := smtp.SendMail(addr, auth, cfg.FromEmail, []string{to}, msg.Bytes()); err != nil {
		return fmt.Errorf("smtp sendmail: %w", err)
	}
	return nil
}

// SendDigest stitches the cards from `rows` into one envelope and
// sends it to the user. Returns nil if there was nothing to send (no
// rows or no email address).
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
		cards.WriteString(r.HTML)
	}

	botLabel := bot.Name
	if botLabel == "" {
		botLabel = bot.BotID
	}
	heading := fmt.Sprintf(`%d new from "%s"`, len(rows), botLabel)
	subject := fmt.Sprintf(`%d new match%s — %s`, len(rows), plural(len(rows)), botLabel)

	unsubURL, err := buildUnsubscribeURL(cfg, user.ID.Hex())
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}

	body := envelope(heading, "", unsubURL, cards.String())
	if err := sendMail(cfg, user.Email, subject, body); err != nil {
		return err
	}
	slog.Info("digest sent",
		"user", user.Email, "config_id", bot.ConfigID, "bot_id", bot.BotID, "rows", len(rows))
	return nil
}

// SendWelcome dispatches a one-shot confirmation email for a brand-new
// configuration. Both `subject` and `cardHTML` are produced by the
// originating bot service and treated as opaque ready-to-send strings;
// we only wrap them in the standard envelope (header + footer +
// unsubscribe).
func SendWelcome(cfg config.Config, user repository.User, subject, cardHTML string) error {
	if user.Email == "" {
		slog.Warn("welcome: user has no email, skipping", "user_id", user.ID.Hex())
		return nil
	}
	if cardHTML == "" {
		return nil
	}

	unsubURL, err := buildUnsubscribeURL(cfg, user.ID.Hex())
	if err != nil {
		return fmt.Errorf("build unsubscribe url: %w", err)
	}

	heading := subject
	if heading == "" {
		heading = "Your new bot is now active"
	}
	body := envelope(heading, "", unsubURL, cardHTML)
	return sendMail(cfg, user.Email, subject, body)
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "es"
}
