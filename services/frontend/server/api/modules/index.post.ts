import { z } from 'zod'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { NOTIFICATION_SCHEMA } from '~~/server/utils/notification-spec'
import { validateConfigSchemaShape, EMPTY_CONFIG_SCHEMA } from '~~/server/utils/config-schema'

const MAX_CODE_BYTES = 1_048_576
const MAX_DESC_BYTES = 32_768

const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
const SOURCE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(MAX_DESC_BYTES).default(''),
  collection: z.string().regex(COLLECTION_PATTERN, {
    message: 'collection must be lowercase alphanumeric with `_`, starting with a letter'
  }),
  source: z.string().regex(SOURCE_PATTERN, {
    message: 'source must be lowercase alphanumeric with `_`, starting with a letter'
  }),
  configSchema: z.record(z.string(), z.unknown()).default(EMPTY_CONFIG_SCHEMA),
  notification: NOTIFICATION_SCHEMA,
  code: z.string().min(1).refine(
    v => new TextEncoder().encode(v).byteLength <= MAX_CODE_BYTES,
    { message: 'Module bundle exceeds 1 MB limit' }
  )
})

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  try {
    validateConfigSchemaShape(body.configSchema)
  } catch (err) {
    throw createError({ statusCode: 400, statusMessage: (err as Error).message })
  }

  const db = await getDb()
  const now = new Date()
  const { insertedId } = await db.collection(COLLECTIONS.modules).insertOne({
    name: body.name,
    description: body.description,
    collection: body.collection,
    source: body.source,
    configSchema: body.configSchema,
    notification: body.notification,
    code: body.code,
    uploaded_by: userId,
    created_at: now,
    updated_at: now
  })

  return { id: insertedId.toHexString() }
})
