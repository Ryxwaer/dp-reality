import { getCurrentSessionRecord } from '~~/server/utils/session'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

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
