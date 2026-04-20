// Package unsubscribe implements the HMAC-signed token scheme shared
// with the frontend. The TypeScript companion lives in
// services/frontend/server/utils/unsubscribe-token.ts — keep the two
// wire formats in lockstep.
package unsubscribe

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// Payload mirrors the TS `UnsubscribePayload`.
//
// uid: Mongo ObjectID hex for the user.
// src: source key (e.g. "bazos", "sreality", or a collection name).
// exp: unix seconds expiry.
type Payload struct {
	UID string `json:"uid"`
	Src string `json:"src"`
	Exp int64  `json:"exp"`
}

// DefaultTTL is the validity window when callers don't pick one.
const DefaultTTL = 30 * 24 * time.Hour

// Sign returns `base64url(json(payload)).base64url(hmac_sha256)`.
func Sign(secret string, p Payload) (string, error) {
	if secret == "" {
		return "", errors.New("UNSUBSCRIBE_SECRET is not configured")
	}
	if p.Exp == 0 {
		p.Exp = time.Now().Add(DefaultTTL).Unix()
	}
	body, err := json.Marshal(p)
	if err != nil {
		return "", fmt.Errorf("marshal payload: %w", err)
	}
	bodyB64 := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(bodyB64))
	sigB64 := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return bodyB64 + "." + sigB64, nil
}

// Verify returns the decoded payload if the signature matches and the
// token hasn't expired. Unused here (the frontend does the verification
// on incoming requests), but symmetric for tests and future tooling.
func Verify(secret, token string) (Payload, error) {
	if secret == "" {
		return Payload{}, errors.New("UNSUBSCRIBE_SECRET is not configured")
	}
	for i := 0; i < len(token); i++ {
		if token[i] == '.' {
			bodyB64 := token[:i]
			sigB64 := token[i+1:]
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(bodyB64))
			expected := mac.Sum(nil)
			got, err := base64.RawURLEncoding.DecodeString(sigB64)
			if err != nil {
				return Payload{}, fmt.Errorf("decode signature: %w", err)
			}
			if !hmac.Equal(expected, got) {
				return Payload{}, errors.New("signature mismatch")
			}
			body, err := base64.RawURLEncoding.DecodeString(bodyB64)
			if err != nil {
				return Payload{}, fmt.Errorf("decode payload: %w", err)
			}
			var p Payload
			if err := json.Unmarshal(body, &p); err != nil {
				return Payload{}, fmt.Errorf("parse payload: %w", err)
			}
			if time.Unix(p.Exp, 0).Before(time.Now()) {
				return Payload{}, errors.New("token expired")
			}
			return p, nil
		}
	}
	return Payload{}, errors.New("malformed token")
}
