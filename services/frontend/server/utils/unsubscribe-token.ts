import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Unsubscribe-token format, identical to the Go implementation in
 * services/notification/internal/unsubscribe:
 *
 *     <base64url(payload_json)>.<base64url(hmac_sha256)>
 *
 * Payload shape: { uid: string, src: string, exp: unix_seconds }
 *
 * We hand-roll a tiny signed-token scheme instead of pulling in a JWT
 * library because the surface is small (three fields, no nested claims)
 * and the secret is co-owned with a non-Node service, so keeping the
 * format trivially reimplementable is worth more than JWT niceties.
 */

export interface UnsubscribePayload {
  /** User id (Mongo ObjectID hex). */
  uid: string
  /** Source key the email was sent for (e.g. `bazos`, `sreality`, or a collection name). */
  src: string
  /** Expiry, unix seconds. */
  exp: number
}

/** Default validity window if the caller doesn't override. 30 days. */
const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signUnsubscribeToken(
  payload: Omit<UnsubscribePayload, 'exp'> & { exp?: number },
  secret: string
): string {
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not configured')
  const now = Math.floor(Date.now() / 1000)
  const fullPayload: UnsubscribePayload = {
    uid: payload.uid,
    src: payload.src,
    exp: payload.exp ?? (now + DEFAULT_TTL_SECONDS)
  }
  const body = b64url(JSON.stringify(fullPayload))
  const sig = b64url(createHmac('sha256', secret).update(body).digest())
  return `${body}.${sig}`
}

export interface VerifyResult {
  ok: boolean
  payload?: UnsubscribePayload
  reason?: 'format' | 'signature' | 'expired' | 'payload'
}

export function verifyUnsubscribeToken(token: string, secret: string): VerifyResult {
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not configured')
  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'format' }
  const [body, sig] = parts
  if (!body || !sig) return { ok: false, reason: 'format' }

  const expected = createHmac('sha256', secret).update(body).digest()
  let received: Buffer
  try {
    received = b64urlDecode(sig)
  } catch {
    return { ok: false, reason: 'signature' }
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return { ok: false, reason: 'signature' }
  }

  let payload: UnsubscribePayload
  try {
    const raw = b64urlDecode(body).toString('utf8')
    const parsed = JSON.parse(raw) as UnsubscribePayload
    if (typeof parsed.uid !== 'string' || typeof parsed.src !== 'string' || typeof parsed.exp !== 'number') {
      return { ok: false, reason: 'payload' }
    }
    payload = parsed
  } catch {
    return { ok: false, reason: 'payload' }
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: 'expired' }
  }

  return { ok: true, payload }
}
