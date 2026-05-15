import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { clearUserSession, deleteAllSessionsForUser } from '~~/server/utils/session'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const db = await getDb()

  await Promise.all([
    db.collection(COLLECTIONS.users).deleteOne({ _id: user._id }),
    db.collection(COLLECTIONS.notifications).deleteMany({ user_id: user._id })
  ])

  // Wipe every session the user owns, not just the current one — a
  // half-deleted account that still served requests from another tab
  // would be a security regression. clearUserSession then drops the
  // current cookies on the responding tab.
  await deleteAllSessionsForUser(user._id)
  await clearUserSession(event)

  return { ok: true }
})
