import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { NOTIFICATION_SCHEMA } from '~~/server/utils/notification-spec'
import { validateConfigSchemaShape } from '~~/server/utils/config-schema'

const MAX_CODE_BYTES = 1_048_576
const MAX_DESC_BYTES = 32_768

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(MAX_DESC_BYTES).optional(),
  configSchema: z.record(z.string(), z.unknown()).optional(),
  notification: NOTIFICATION_SCHEMA.optional(),
  code: z.string().min(1).refine(
    v => new TextEncoder().encode(v).byteLength <= MAX_CODE_BYTES,
    { message: 'Module bundle exceeds 1 MB limit' }
  ).optional()
}).strict()

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const rawId = getRouterParam(event, 'id')

  if (!rawId || !ObjectId.isValid(rawId)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid module id' })
  }
  const moduleId = new ObjectId(rawId)

  const body = await readValidatedBody(event, bodySchema.parse)

  if (body.configSchema !== undefined) {
    try {
      validateConfigSchemaShape(body.configSchema)
    } catch (err) {
      throw createError({ statusCode: 400, statusMessage: (err as Error).message })
    }
  }

  const db = await getDb()
  const existing = await db.collection(COLLECTIONS.modules).findOne(
    { _id: moduleId },
    { projection: { code: 0 } }
  )
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }

  const isSystem = existing.system === true
  const isOwner = existing.uploaded_by instanceof ObjectId
    && existing.uploaded_by.equals(userId)
  if (!isSystem && !isOwner) {
    throw createError({
      statusCode: 403,
      statusMessage: 'Only the uploader can edit this module'
    })
  }

  if (isSystem && body.code !== undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The bundle of a system module cannot be replaced via edit; modify the repo and redeploy.'
    })
  }

  const update: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) update.name = body.name
  if (body.description !== undefined) update.description = body.description
  if (body.configSchema !== undefined) update.configSchema = body.configSchema
  if (body.notification !== undefined) update.notification = body.notification
  if (body.code !== undefined) update.code = body.code

  if (Object.keys(update).length === 1) {
    return { id: moduleId.toHexString(), changed: false }
  }

  await db.collection(COLLECTIONS.modules).updateOne(
    { _id: moduleId },
    { $set: update }
  )

  return { id: moduleId.toHexString(), changed: true }
})
