/**
 * Client-side session composable. Replaces the `useUserSession` that
 * the now-removed `nuxt-auth-utils` module provided so existing call
 * sites (`auth.global.ts`, `UserMenu.vue`, settings pages, etc.) keep
 * working unchanged.
 *
 * The reactive state lives in Nuxt `useState`, which is shared between
 * the SSR render and the client hydration step. The session hydration
 * plugin (`app/plugins/session.ts`) calls `fetch()` once at app boot;
 * after that every page reads from the same in-memory copy.
 */

export interface SessionUser {
  id: string
  email: string
  name: string
}

export interface SessionPayload {
  user?: SessionUser
  loggedInAt?: string
}

export function useUserSession() {
  const session = useState<SessionPayload>('user-session', () => ({}))

  async function fetch() {
    try {
      // useRequestFetch() forwards the incoming request's Cookie header
      // when called during SSR, so the server-rendered HTML reflects
      // the logged-in user without an extra round-trip. On the client
      // it falls back to the standard $fetch instance.
      const requestFetch = useRequestFetch()
      const data = await requestFetch<SessionPayload>('/api/_auth/session')
      session.value = data ?? {}
    } catch {
      session.value = {}
    }
  }

  function clear() {
    // Local-only state reset. The actual session row + cookies are
    // wiped server-side by the route that called us (e.g. the
    // explicit `$fetch('/api/auth/logout', { method: 'POST' })` in
    // UserMenu). Keeping this synchronous matches the previous
    // module's `clear` semantics so callers can keep `await`-ing it.
    session.value = {}
  }

  return {
    loggedIn: computed(() => !!session.value.user),
    user: computed(() => session.value.user ?? null),
    session,
    fetch,
    clear
  }
}
