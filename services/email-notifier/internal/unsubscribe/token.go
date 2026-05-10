// Unsubscribe token signing.
//
// The notifier signs tokens with the same shared secret the BFF uses
// to verify them, so the link in the email lands on the BFF unsubscribe
// page where the actual user/bot lookup and toggling happens.
//
// Payload is intentionally minimal: just user_id + an issued-at
// timestamp. The BFF re-derives the bot list from the user document at
// click time, so we don't need to encode any bot-specific routing here.
package unsubscribe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Payload struct {
	UID       string `json:"uid"`
	IssuedAt  int64  `json:"iat"`
}

func b64UrlEncode(in []byte) string {
	return base64.RawURLEncoding.EncodeToString(in)
}

func b64UrlDecode(in string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(in)
}

// Sign returns "<base64url(payload)>.<base64url(hmac)>".
func Sign(secret string, p Payload) (string, error) {
	if secret == "" {
		return "", errors.New("unsubscribe: empty secret")
	}
	if p.IssuedAt == 0 {
		p.IssuedAt = time.Now().Unix()
	}
	body, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	encBody := b64UrlEncode(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(encBody))
	return encBody + "." + b64UrlEncode(mac.Sum(nil)), nil
}

// Verify is provided for symmetry with the BFF; the notifier itself
// only ever signs, but tests/CLIs find this useful.
func Verify(secret, token string) (Payload, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 {
		return Payload{}, errors.New("unsubscribe: malformed token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0]))
	expected := b64UrlEncode(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[1])) {
		return Payload{}, errors.New("unsubscribe: bad signature")
	}
	body, err := b64UrlDecode(parts[0])
	if err != nil {
		return Payload{}, err
	}
	var p Payload
	if err := json.Unmarshal(body, &p); err != nil {
		return Payload{}, err
	}
	return p, nil
}
