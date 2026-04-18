package emailer

import (
	"bytes"
	"fmt"
	"html"
	"log/slog"
	"net/smtp"
	"strings"

	"dp-reality/notification/internal/config"
	"dp-reality/notification/internal/models"
)

func formatPrice(l models.Listing) string {
	if l.Price == nil {
		return "Cena neuvedena"
	}
	suffix := "Kč"
	if l.PriceType == "rent" {
		suffix = "Kč/měs."
	}
	return fmt.Sprintf("%d\u00a0%s", *l.Price, suffix)
}

func renderHTML(listings []models.Listing, user models.User, cfg config.Config) string {
	var sb strings.Builder
	for _, l := range listings {
		cityHTML := ""
		if l.City != nil {
			cityHTML = fmt.Sprintf(`<p style="margin:4px 0;color:#555;font-size:14px">%s</p>`, html.EscapeString(*l.City))
		}
		sb.WriteString(fmt.Sprintf(`
		<a href="%s" style="text-decoration:none;color:inherit" target="_blank">
		  <div style="margin-bottom:16px;padding:16px;border:1px solid #e0e0e0;border-radius:8px;font-family:Arial,sans-serif">
		    <h3 style="margin:0 0 8px;color:#2c3e50;font-size:16px">%s</h3>
		    <p style="margin:4px 0;color:#27ae60;font-weight:bold">%s</p>
		    %s
		    <p style="margin:4px 0;color:#999;font-size:12px">%s</p>
		  </div>
		</a>`, html.EscapeString(l.URL), html.EscapeString(l.Title), formatPrice(l), cityHTML, html.EscapeString(l.Source)))
	}

	unsubURL := fmt.Sprintf("%s/unsubscribe/%s", cfg.AppBaseURL, user.UnsubscribeToken)
	return fmt.Sprintf(`<html>
<body style="max-width:600px;margin:auto;padding:20px;font-family:Arial,sans-serif">
  <h2 style="color:#2c3e50;border-bottom:2px solid #e0e0e0;padding-bottom:12px">Nové reality (%d)</h2>
  %s
  <p style="margin-top:32px;font-size:12px;color:#999;border-top:1px solid #e0e0e0;padding-top:12px">
    <a href="%s" style="color:#999">Odhlásit odběr</a>
  </p>
</body>
</html>`, len(listings), sb.String(), unsubURL)
}

func Send(cfg config.Config, user models.User, listings []models.Listing) error {
	if cfg.SMTPServer == "" {
		slog.Warn("SMTP not configured, skipping email",
			"user", user.Email, "count", len(listings))
		return nil
	}

	auth := smtp.PlainAuth("", cfg.SMTPLogin, cfg.SMTPPassword, cfg.SMTPServer)

	var msg bytes.Buffer
	fmt.Fprintf(&msg, "From: %s\r\n", cfg.FromEmail)
	fmt.Fprintf(&msg, "To: %s\r\n", user.Email)
	fmt.Fprintf(&msg, "Subject: Nové reality — %d nových inzerátů\r\n", len(listings))
	fmt.Fprintf(&msg, "MIME-Version: 1.0\r\n")
	fmt.Fprintf(&msg, "Content-Type: text/html; charset=UTF-8\r\n\r\n")
	fmt.Fprint(&msg, renderHTML(listings, user, cfg))

	addr := fmt.Sprintf("%s:%d", cfg.SMTPServer, cfg.SMTPPort)
	if err := smtp.SendMail(addr, auth, cfg.FromEmail, []string{user.Email}, msg.Bytes()); err != nil {
		return fmt.Errorf("smtp sendmail: %w", err)
	}
	slog.Info("email sent", "user", user.Email, "listings", len(listings))
	return nil
}
