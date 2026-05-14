// Email envelope assembler.
//
// The bot service has already produced the per-message HTML (one
// "card" per matched listing for a digest, or a self-contained welcome
// card for a brand-new configuration). This package only stacks that
// HTML inside a generic envelope that carries:
//   - a banner with the bot name + match count;
//   - the cards verbatim, in the order the bot service wrote them,
//     each wrapped in a per-card <a href> pointing at the listing URL
//     so the whole tile is a click target in the email client (the
//     inner anchors the bot bakes for the title + CTA button keep
//     working; both layers point at the same URL, so however a given
//     client resolves the nested anchors the user lands on the same
//     page);
//   - a footer with an unsubscribe link.
//
// We never inspect or re-render the card contents; the bot's HTML is
// embedded verbatim inside the per-card anchor.
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
	// `color-scheme: only light` is the documented opt-out from
	// dark-mode auto-inversion in mail clients that honour it (Apple
	// Mail, modern Gmail, Outlook web). Without it, those clients
	// recolour our intentionally light-on-light palette into their own
	// dark-mode equivalents — turning text inside the tile-wide <a>
	// into link-blue and the white card background into a dim grey,
	// which destroys the per-element inline `color:` styling we rely on.
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

// buildUnsubscribeURL signs a token that identifies the recipient and,
// when provided, the bot that triggered the email. The BFF reads `bid`
// as a UI hint to pre-select the "disable emails" checkbox for that
// bot's configs on the unsubscribe page — it does NOT scope the
// available actions, since the user is still allowed to manage every
// bot they own from the same page.
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

// sendMail emits a properly-encoded RFC 5322 message. The HTML body is
// passed through quoted-printable so postfix never has to break a line
// itself — without this, postfix's <CR><LF><SPACE> soft-wrap of any
// line longer than 998 bytes lands wherever the offset happens to fall,
// which for our long single-line digests has been observed to split a
// `<div>` opening tag, rendering the surrounding markup as literal
// text in mail clients. The Subject is RFC 2047 Q-encoded so non-ASCII
// (em dashes, accented characters) survives in clients that don't
// auto-decode raw 8-bit headers.
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

// SendWelcome dispatches a one-shot confirmation email for a brand-new
// configuration. Both `subject` and `cardHTML` are produced by the
// originating bot service and treated as opaque ready-to-send strings;
// we only wrap them in the standard envelope (header + footer +
// unsubscribe). `botID` is the originating service id — embedded in
// the unsubscribe token so the page can pre-select that bot's configs
// if the recipient clicks through.
func SendWelcome(cfg config.Config, user repository.User, botID, subject, cardHTML string) error {
	if user.Email == "" {
		slog.Warn("welcome: user has no email, skipping", "user_id", user.ID.Hex())
		return nil
	}
	if cardHTML == "" {
		return nil
	}

	unsubURL, err := buildUnsubscribeURL(cfg, user.ID.Hex(), botID)
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

// wrapCardLink turns a bot-rendered card into a tile-wide click target.
//
// The inline styles deliberately neutralise the user-agent <a> defaults
// (underline, link color) so the bot's own typography wins; `display:block`
// is required because the card itself is a block-level <div> — without it
// some clients render the wrapper as inline and collapse the layout.
//
// `url` is escaped for attribute context; the card HTML is the bot's
// contract and is embedded verbatim. An empty URL falls back to the
// unwrapped card so a misconfigured row still renders rather than
// shipping a dead anchor.
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
