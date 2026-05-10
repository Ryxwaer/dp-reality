import { createHmac, timingSafeEqual } from 'node:crypto'

// Token format mirrors services/email-notifier/internal/unsubscribe:
//   <base64url(payload_json)>.<base64url(hmac_sha256)>
//
// Payload is just the user id + an issued-at + an expiry.
// The bot list comes from the user document at click time, so there's
// no per-bot or per-source claim baked into the token.
export interface UnsubscribePayload {
  uid: string
  iat: number
  exp: number
}

const DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

export function signUnsubscribeToken(uid: string, secret: string, ttlSeconds = DEFAULT_TTL_SECONDS): string {
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not configured')
  const now = Math.floor(Date.now() / 1000)
  const payload: UnsubscribePayload = { uid, iat: now, exp: now + ttlSeconds }
  const body = b64url(JSON.stringify(payload))
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
    if (typeof parsed.uid !== 'string') return { ok: false, reason: 'payload' }
    if (parsed.exp !== undefined && parsed.exp < Math.floor(Date.now() / 1000)) {
      return { ok: false, reason: 'expired' }
    }
    payload = parsed
  } catch {
    return { ok: false, reason: 'payload' }
  }

  return { ok: true, payload }
}
