import type { H3Event } from 'h3'
import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'

/**
 * Mongo-backed session store. Replaces the previous `nuxt-auth-utils`
 * cookie-encrypted session so that the BFF can be replicated horizontally
 * (thesis §3.7.3 — "session state persisted in MongoDB").
 *
 * Wire shape
 * ----------
 * - `dp-session` cookie: HttpOnly, opaque 32-byte hex session id. The
 *   cookie carries the id only; everything else lives in Mongo and the
 *   server is the source of truth.
 * - `csrf-token` cookie: NOT HttpOnly (must be readable by app JS for
 *   the double-submit pattern), same lifetime as the session. Holds the
 *   server-minted CSRF token; the browser echoes it back as the
 *   `X-CSRF-Token` request header on every state-changing call. The
 *   match check lives in `server/middleware/csrf.ts`.
 *
 * Both cookies are `SameSite=Lax`. `Secure` is on in production (the
 * nginx-proxy-manager → ingress-nginx → BFF chain terminates TLS at the
 * outermost hop, so the browser only ever sees the cookies over HTTPS
 * in prod) and off in development so plain-HTTP `nuxt dev` works.
 */

export interface SessionUser {
  id: string
  email: string
  name: string
}

export interface UserSession {
  user: SessionUser
  loggedInAt: string
}

export interface SessionRecord {
  _id: string
  user_id: ObjectId
  csrf_token: string
  created_at: Date
  last_seen: Date
  expires_at: Date
  user_agent: string
  ip: string
}

const SESSION_COOKIE = 'dp-session'
const CSRF_COOKIE = 'csrf-token'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
// Only persist `last_seen` if it has drifted by at least this much.
// Keeps every authenticated request from issuing a Mongo write while
// still letting an idle session expire within ~1 % of `SESSION_TTL_MS`.
const TOUCH_THRESHOLD_MS = 5 * 60 * 1000

function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

function isHex(s: string, len: number): boolean {
  return s.length === len && /^[0-9a-f]+$/.test(s)
}

function cookieAttrs(maxAgeMs: number, httpOnly: boolean) {
  return {
    httpOnly,
    secure: isProd(),
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(maxAgeMs / 1000)
  }
}

function getClientIp(event: H3Event): string {
  const fwd = getHeader(event, 'x-forwarded-for')
  if (fwd) {
    // First hop only — this BFF sits behind one trusted reverse proxy
    // (ingress-nginx); chained X-Forwarded-For values come from
    // upstream proxies and are not authoritative.
    return fwd.split(',')[0]?.trim() ?? ''
  }
  return event.node.req.socket?.remoteAddress ?? ''
}

function getUserAgent(event: H3Event): string {
  return getHeader(event, 'user-agent') ?? ''
}

function setSessionCookies(event: H3Event, sessionId: string, csrfToken: string, maxAgeMs: number): void {
  setCookie(event, SESSION_COOKIE, sessionId, cookieAttrs(maxAgeMs, true))
  setCookie(event, CSRF_COOKIE, csrfToken, cookieAttrs(maxAgeMs, false))
}

function clearSessionCookies(event: H3Event): void {
  // maxAge: 0 + path match → browser deletes both immediately.
  setCookie(event, SESSION_COOKIE, '', { ...cookieAttrs(0, true), maxAge: 0 })
  setCookie(event, CSRF_COOKIE, '', { ...cookieAttrs(0, false), maxAge: 0 })
}

function getSessionIdFromCookie(event: H3Event): string | null {
  const raw = getCookie(event, SESSION_COOKIE)
  if (!raw) return null
  if (!isHex(raw, 64)) return null
  return raw
}

async function loadSession(sessionId: string): Promise<SessionRecord | null> {
  const db = await getDb()
  const row = await db
    .collection<SessionRecord>(COLLECTIONS.sessions)
    .findOne({ _id: sessionId })

  if (!row) return null
  if (row.expires_at.getTime() <= Date.now()) {
    // Mongo's TTL sweep runs ~once per minute; an expired row we read
    // before the sweep has fired must still be treated as gone.
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: sessionId })
    return null
  }
  return row
}

async function touchSession(row: SessionRecord): Promise<SessionRecord> {
  const now = new Date()
  if (now.getTime() - row.last_seen.getTime() < TOUCH_THRESHOLD_MS) {
    return row
  }
  const next: SessionRecord = {
    ...row,
    last_seen: now,
    expires_at: new Date(now.getTime() + SESSION_TTL_MS)
  }
  const db = await getDb()
  await db.collection(COLLECTIONS.sessions).updateOne(
    { _id: row._id },
    { $set: { last_seen: next.last_seen, expires_at: next.expires_at } }
  )
  return next
}

async function loadUserSession(row: SessionRecord): Promise<UserSession | null> {
  const db = await getDb()
  const user = await db
    .collection<{ _id: ObjectId, email: string, name: string }>(COLLECTIONS.users)
    .findOne(
      { _id: row.user_id },
      { projection: { email: 1, name: 1 } }
    )
  if (!user) return null
  return {
    user: {
      id: user._id.toHexString(),
      email: user.email,
      name: user.name
    },
    loggedInAt: row.created_at.toISOString()
  }
}

/**
 * Create a fresh session row, mint a CSRF token, and emit both cookies.
 * Called by `/api/auth/register` and `/api/auth/login`. Replaces the
 * previous `nuxt-auth-utils` `setUserSession()` export.
 */
export async function setUserSession(event: H3Event, payload: { user: SessionUser, loggedInAt?: string }): Promise<void> {
  const now = new Date()
  const sessionId = randomHex(32)
  const csrfToken = randomHex(32)
  const row: SessionRecord = {
    _id: sessionId,
    user_id: new ObjectId(payload.user.id),
    csrf_token: csrfToken,
    created_at: payload.loggedInAt ? new Date(payload.loggedInAt) : now,
    last_seen: now,
    expires_at: new Date(now.getTime() + SESSION_TTL_MS),
    user_agent: getUserAgent(event),
    ip: getClientIp(event)
  }
  const db = await getDb()
  await db.collection<SessionRecord>(COLLECTIONS.sessions).insertOne(row)
  setSessionCookies(event, sessionId, csrfToken, SESSION_TTL_MS)
}

/**
 * Resolve the current session into a `{ user, loggedInAt }` payload,
 * touching `last_seen` if the row has gone stale. Returns null when
 * there is no usable session — caller decides whether to 401.
 */
export async function getUserSession(event: H3Event): Promise<UserSession | null> {
  const sessionId = getSessionIdFromCookie(event)
  if (!sessionId) return null

  const row = await loadSession(sessionId)
  if (!row) {
    // Cookie pointed at a row that's gone (logout from another tab,
    // TTL sweep, manual delete). Drop the dangling cookies so the next
    // request doesn't keep paying for a no-op Mongo lookup.
    clearSessionCookies(event)
    return null
  }

  await touchSession(row)

  const payload = await loadUserSession(row)
  if (!payload) {
    // The user row was deleted but a session row outlived it. Treat as
    // logged out; clean up so we don't leak orphaned sessions forever.
    const db = await getDb()
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: row._id })
    clearSessionCookies(event)
    return null
  }

  return payload
}

/**
 * Same as `getUserSession` but throws 401 when the session is missing.
 * Drop-in for the previous `nuxt-auth-utils` export.
 */
export async function requireUserSession(event: H3Event): Promise<UserSession> {
  const payload = await getUserSession(event)
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return payload
}

/**
 * Return the raw `sessions` row for the current cookie, or null. Used
 * by the CSRF middleware to compare the header token against the
 * server-side value, and by the `/api/auth/sessions` DELETE route.
 */
export async function getCurrentSessionRecord(event: H3Event): Promise<SessionRecord | null> {
  const sessionId = getSessionIdFromCookie(event)
  if (!sessionId) return null
  return loadSession(sessionId)
}

/**
 * Mint a fresh CSRF token on the current session and update the
 * cookie. Standard practice on login (already covered — `setUserSession`
 * mints from scratch) and on privilege change (password rotation).
 */
export async function rotateCsrfToken(event: H3Event): Promise<string | null> {
  const sessionId = getSessionIdFromCookie(event)
  if (!sessionId) return null
  const csrfToken = randomHex(32)
  const db = await getDb()
  const result = await db
    .collection<SessionRecord>(COLLECTIONS.sessions)
    .updateOne({ _id: sessionId }, { $set: { csrf_token: csrfToken } })
  if (result.matchedCount === 0) return null
  setCookie(event, CSRF_COOKIE, csrfToken, cookieAttrs(SESSION_TTL_MS, false))
  return csrfToken
}

/**
 * Delete the current session row and clear both cookies. The Mongo
 * delete must happen first — clearing the cookie alone leaves a row
 * behind that can be reused by anyone who replays the cookie before
 * the TTL sweep fires.
 */
export async function clearUserSession(event: H3Event): Promise<void> {
  const sessionId = getSessionIdFromCookie(event)
  if (sessionId) {
    const db = await getDb()
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: sessionId })
  }
  clearSessionCookies(event)
}

/**
 * Delete every session for a user. Used by `DELETE /api/auth/sessions`
 * (operator-grade "log out everywhere") and as a safety net when an
 * account is deleted, so a logged-in tab on a dead account can't keep
 * issuing authenticated requests until the TTL sweep catches up.
 */
export async function deleteAllSessionsForUser(userId: ObjectId): Promise<number> {
  const db = await getDb()
  const result = await db
    .collection(COLLECTIONS.sessions)
    .deleteMany({ user_id: userId })
  return result.deletedCount ?? 0
}
