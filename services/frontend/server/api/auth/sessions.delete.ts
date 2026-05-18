import { requireUserId } from '~~/server/utils/auth'
import { clearUserSession, deleteAllSessionsForUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const deleted = await deleteAllSessionsForUser(userId)
  await clearUserSession(event)
  return { ok: true, deleted }
})
