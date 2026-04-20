import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { BOT_STATUSES } from '~~/shared/types'
import { MATCHER_SCHEMA } from '~~/server/utils/module-matcher'
import { validateBotConfig, ConfigValidationFailed, EMPTY_CONFIG_SCHEMA } from '~~/server/utils/config-schema'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  matcher: MATCHER_SCHEMA.optional(),
  active: z.boolean().optional(),
  status: z.enum(BOT_STATUSES.filter(s => s !== 'deleted') as [string, ...string[]]).optional(),
  email_notifications: z.boolean().optional()
}).refine(
  v => v.name !== undefined
    || v.config !== undefined
    || v.matcher !== undefined
    || v.active !== undefined
    || v.status !== undefined
    || v.email_notifications !== undefined,
  { message: 'At least one field must be provided' }
).refine(
  v => (v.config === undefined) === (v.matcher === undefined),
  { message: '`config` and `matcher` must be patched together' }
)

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bot id required' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)

  const db = await getDb()

  if (body.config !== undefined) {
    const userDoc = await db.collection(COLLECTIONS.users).findOne(
      { '_id': user._id, 'bots.id': id },
      { projection: { 'bots.$': 1 } }
    )
    const bot = (userDoc?.bots as Array<{ id: string, module_id?: string }> | undefined)?.[0]
    if (!bot) {
      throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
    }
    if (!bot.module_id || !ObjectId.isValid(bot.module_id)) {
      throw createError({ statusCode: 422, statusMessage: 'Bot has no valid module_id — recreate it' })
    }
    const moduleDoc = await db.collection(COLLECTIONS.modules).findOne(
      { _id: new ObjectId(bot.module_id) },
      { projection: { configSchema: 1 } }
    )
    const configSchema = (moduleDoc?.configSchema as Record<string, unknown> | undefined) ?? EMPTY_CONFIG_SCHEMA
    try {
      validateBotConfig(configSchema, body.config)
    } catch (err) {
      if (err instanceof ConfigValidationFailed) {
        throw createError({
          statusCode: 400,
          statusMessage: 'Invalid bot config',
          data: { errors: err.errors }
        })
      }
      throw err
    }
  }

  const set: Record<string, unknown> = {}
  if (body.name !== undefined) set['bots.$[bot].name'] = body.name
  if (body.config !== undefined) set['bots.$[bot].config'] = body.config
  if (body.matcher !== undefined) set['bots.$[bot].matcher'] = body.matcher
  if (body.email_notifications !== undefined) {
    set['bots.$[bot].email_notifications'] = body.email_notifications
  }

  if (body.status !== undefined) {
    set['bots.$[bot].status'] = body.status
  } else if (body.active !== undefined) {
    set['bots.$[bot].status'] = body.active ? 'active' : 'stopped'
  }

  const unset: Record<string, unknown> = {}
  if (set['bots.$[bot].status'] !== undefined) {
    unset['bots.$[bot].active'] = ''
  }

  const update: Record<string, unknown> = { $set: set }
  if (Object.keys(unset).length > 0) {
    update.$unset = unset
  }

  const result = await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    update,
    {
      arrayFilters: [{ 'bot.id': id, 'bot.status': { $ne: 'deleted' } }]
    }
  )

  if (result.matchedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }
  if (result.modifiedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }

  return { ok: true }
})
