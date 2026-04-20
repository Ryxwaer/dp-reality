import { ObjectId } from 'mongodb'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { EMPTY_CONFIG_SCHEMA } from '~~/server/utils/config-schema'
import type { ModuleDoc, NotificationSpec } from '~~/shared/types'

const EMPTY_NOTIFICATION: NotificationSpec = {
  subject: '',
  title: '',
  url: '',
  fields: []
}

export default defineEventHandler(async (event): Promise<ModuleDoc> => {
  const userId = await requireUserId(event)
  const rawId = getRouterParam(event, 'id')

  if (!rawId || !ObjectId.isValid(rawId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid module id' })
  }

  const db = await getDb()
  const doc = await db.collection(COLLECTIONS.modules).findOne(
    { _id: new ObjectId(rawId) },
    { projection: { code: 0 } }
  )

  if (!doc) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  void userId

  const configSchema = (doc.configSchema as Record<string, unknown> | undefined)
    ?? EMPTY_CONFIG_SCHEMA
  const notification = (doc.notification as NotificationSpec | undefined) ?? EMPTY_NOTIFICATION

  return {
    id: doc._id.toHexString(),
    name: doc.name as string,
    description: (doc.description as string) ?? '',
    collection: (doc.collection as string) ?? '',
    source: (doc.source as string) ?? '',
    configSchema,
    notification,
    uploaded_by: (doc.uploaded_by as ObjectId).toHexString(),
    created_at: (doc.created_at as Date).toISOString(),
    updated_at: (doc.updated_at as Date).toISOString(),
    system: doc.system === true
  }
})
