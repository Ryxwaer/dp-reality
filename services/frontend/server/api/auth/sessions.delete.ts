import { requireUserId } from '~~/server/utils/auth'
import { clearUserSession, deleteAllSessionsForUser } from '~~/server/utils/session'

/**
 * Log out everywhere. Deletes every `sessions` row for the current
 * user (including the one this request is authenticated with) and
 * clears the cookies on the responding tab. Useful when the user
 * suspects a credential leak, and as the auth-pruning step in the
 * account-deletion path — see `server/api/user.delete.ts`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const deleted = await deleteAllSessionsForUser(userId)
  await clearUserSession(event)
  return { ok: true, deleted }
})
