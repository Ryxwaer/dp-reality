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
      const requestFetch = useRequestFetch()
      const data = await requestFetch<SessionPayload>('/api/_auth/session')
      session.value = data ?? {}
    } catch {
      session.value = {}
    }
  }

  function clear() {
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
