/**
 * Read the double-submit CSRF token cookie set server-side by the
 * session util and expose it as a header object ready to be spread
 * into a `$fetch` call's `headers`.
 *
 * `headers()` is a function (not a computed) on purpose: it reads
 * `document.cookie` at call time, so a token rotation (login,
 * password change) is reflected on the very next request without
 * needing to re-mount the page or re-create the composable.
 */

const COOKIE_NAME = 'csrf-token'

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const pattern = new RegExp('(?:^|; )' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)')
  const match = document.cookie.match(pattern)
  return match && match[1] ? decodeURIComponent(match[1]) : null
}

export function useCsrf() {
  return {
    token: () => readCookie(COOKIE_NAME),
    headers: (): Record<string, string> => {
      const token = readCookie(COOKIE_NAME)
      return token ? { 'X-CSRF-Token': token } : {}
    }
  }
}
