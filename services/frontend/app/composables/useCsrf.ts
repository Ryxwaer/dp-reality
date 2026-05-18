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
