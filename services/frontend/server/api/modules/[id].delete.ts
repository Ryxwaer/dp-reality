import { ObjectId } from 'mongodb'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const rawId = getRouterParam(event, 'id')

  if (!rawId || !ObjectId.isValid(rawId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid module id' })
  }

  const db = await getDb()
  const { deletedCount } = await db.collection(COLLECTIONS.modules).deleteOne({
    _id: new ObjectId(rawId),
    uploaded_by: userId
  })

  if (deletedCount === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Module not found or not owned by current user'
    })
  }

  return { ok: true }
})
