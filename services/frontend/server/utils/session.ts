import type { H3Event } from 'h3'
import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'

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

export async function getUserSession(event: H3Event): Promise<UserSession | null> {
  const sessionId = getSessionIdFromCookie(event)
  if (!sessionId) return null

  const row = await loadSession(sessionId)
  if (!row) {
    clearSessionCookies(event)
    return null
  }

  await touchSession(row)

  const payload = await loadUserSession(row)
  if (!payload) {
    const db = await getDb()
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: row._id })
    clearSessionCookies(event)
    return null
  }

  return payload
}

export async function requireUserSession(event: H3Event): Promise<UserSession> {
  const payload = await getUserSession(event)
  if (!payload) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return payload
}

export async function getCurrentSessionRecord(event: H3Event): Promise<SessionRecord | null> {
  const sessionId = getSessionIdFromCookie(event)
  if (!sessionId) return null
  return loadSession(sessionId)
}

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

export async function clearUserSession(event: H3Event): Promise<void> {
  const sessionId = getSessionIdFromCookie(event)
  if (sessionId) {
    const db = await getDb()
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: sessionId })
  }
  clearSessionCookies(event)
}

export async function deleteAllSessionsForUser(userId: ObjectId): Promise<number> {
  const db = await getDb()
  const result = await db
    .collection(COLLECTIONS.sessions)
    .deleteMany({ user_id: userId })
  return result.deletedCount ?? 0
}
