import { getUserSession } from '~~/server/utils/session'

/**
 * Public session-readout endpoint used by the client `useUserSession()`
 * composable to hydrate the reactive session state at app boot and
 * after auth-changing operations. Returns the user payload when the
 * cookie resolves to a live `sessions` row, or an empty object so the
 * client treats it as "logged out" without throwing.
 *
 * This is GET-only and therefore exempt from CSRF; it returns no
 * secret material — the CSRF token itself is delivered via the
 * non-HttpOnly `csrf-token` cookie set by the session util, not via
 * this endpoint's body.
 */
export default defineEventHandler(async (event) => {
  const session = await getUserSession(event)
  return session ?? {}
})
