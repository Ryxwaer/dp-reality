import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)

  const db = await getDb()
  const result = await db
    .collection(COLLECTIONS.notifications)
    .updateMany({ user_id: userId, unread: true }, { $set: { unread: false } })

  return { ok: true, modified: result.modifiedCount }
})
