import { ObjectId } from 'mongodb'
import { requireUserIdHex } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const userId = await requireUserIdHex(event)
  const id = getRouterParam(event, 'id')

  if (!id || !ObjectId.isValid(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid notification id' })
  }

  const db = await getDb()
  const result = await db.collection(COLLECTIONS.notifications).updateOne(
    { _id: new ObjectId(id), user_id: userId },
    { $set: { unread: false } }
  )

  if (result.matchedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Notification not found' })
  }

  return { ok: true }
})
