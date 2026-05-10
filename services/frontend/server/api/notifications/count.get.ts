import { requireUserIdHex } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const userId = await requireUserIdHex(event)

  const db = await getDb()
  const count = await db
    .collection(COLLECTIONS.notifications)
    .countDocuments({ user_id: userId, unread: true })

  return { count }
})
