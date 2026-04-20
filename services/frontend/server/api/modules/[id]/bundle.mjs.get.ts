import { ObjectId } from 'mongodb'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireUserId(event)
  const rawId = getRouterParam(event, 'id')

  if (!rawId || !ObjectId.isValid(rawId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid module id' })
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTIONS.modules).findOne(
    { _id: new ObjectId(rawId) },
    { projection: { code: 1, updated_at: 1 } }
  )

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  const updatedAt = doc.updated_at as Date
  const etag = `"${updatedAt.getTime().toString(16)}"`

  setHeader(event, 'Content-Type', 'application/javascript; charset=utf-8')
  setHeader(event, 'Cache-Control', 'private, max-age=0, must-revalidate')
  setHeader(event, 'ETag', etag)

  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return ''
  }

  return doc.code as string
})
