import { getCurrentSessionRecord } from '~~/server/utils/session'

/**
 * Double-submit CSRF gate on every state-changing request. Sits in
 * `server/middleware/` so it runs BEFORE every route handler, including
 * the `/modules/<bot_id>/<...>` reverse proxy — that ordering is what
 * lets the thesis §3.7.3 "transparent forwarding" claim hold: the BFF
 * validates the token at the proxy boundary so the bot service never
 * has to re-implement CSRF.
 *
 * Contract:
 *   - Safe methods (GET / HEAD / OPTIONS) pass through.
 *   - Non-API paths (the Nuxt SSR HTML / static asset routes) pass
 *     through — the cookie-based same-site protections cover them.
 *   - A small allowlist of endpoints that MUST work without an existing
 *     session (login, register, public unsubscribe) is skipped.
 *   - Otherwise: if a session cookie resolves to a live row, require an
 *     `X-CSRF-Token` header matching `sessions.csrf_token`. Mismatch is
 *     403 — distinct from 401 so the client can tell "your session is
 *     gone" from "your CSRF token is wrong".
 *
 * Unauthenticated state-changing requests fall through unmodified; the
 * downstream route returns its own 401 via `requireUser*`.
 */

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// Routes that MUST be reachable cross-origin with no existing session.
// Login and register because the user has no session yet; unsubscribe
// links because they are tokenised one-shot URLs delivered by email
// and are the *authenticator* themselves (the token IS the auth).
const ALLOWLIST_EXACT = new Set([
  '/api/auth/login',
  '/api/auth/register'
])

const ALLOWLIST_PREFIXES = [
  '/api/unsubscribe/'
]

function isProtectedPath(path: string): boolean {
  return path.startsWith('/api/') || path.startsWith('/modules/')
}

function isAllowlisted(path: string): boolean {
  if (ALLOWLIST_EXACT.has(path)) return true
  return ALLOWLIST_PREFIXES.some(prefix => path.startsWith(prefix))
}

export default defineEventHandler(async (event) => {
  const method = (event.method ?? 'GET').toUpperCase()
  if (SAFE_METHODS.has(method)) return

  const path = (event.path ?? '').split('?')[0] ?? ''
  if (!isProtectedPath(path)) return
  if (isAllowlisted(path)) return

  const session = await getCurrentSessionRecord(event)
  if (!session) {
    // No session means the request is unauthenticated. Let the route's
    // own auth check produce a 401 — masking that as a 403 here would
    // make debugging harder and would not improve security.
    return
  }

  const headerToken = getHeader(event, 'x-csrf-token')
  if (!headerToken || headerToken !== session.csrf_token) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Invalid or missing CSRF token'
    })
  }
})
