import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { publishBotCreated } from '~~/server/utils/events'
import { MATCHER_SCHEMA } from '~~/server/utils/module-matcher'
import { NOTIFICATION_SCHEMA } from '~~/server/utils/notification-spec'
import { validateBotConfig, ConfigValidationFailed, EMPTY_CONFIG_SCHEMA } from '~~/server/utils/config-schema'
import type { NotificationSpec } from '~~/shared/types'

const EMPTY_NOTIFICATION: NotificationSpec = {
  subject: '',
  title: '',
  url: '',
  fields: []
}

/**
 * Create a bot. The module's `.mjs` authored the `matcher` from the
 * user's `config`; we validate both independently here:
 *
 *   - `config` against `module.configSchema` (user-supplied, not trusted)
 *   - `matcher` against MATCHER_SCHEMA (author-supplied, trusted shape
 *     but still shape-validated so a buggy bundle can't insert
 *     `{ op: '$where', … }`)
 *
 * On success we snapshot `{ source, collection, matcher, notification }`
 * onto the bot so the Go notifier never has to join `modules` in its
 * hot path.
 */
const bodySchema = z.object({
  module_id: z.string().refine(v => ObjectId.isValid(v), { message: 'Invalid module_id' }),
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
  matcher: MATCHER_SCHEMA,
  /**
   * Modules still speak the simple "active: bool" protocol through
   * the SaveBot host API. We translate that to `status` here so the
   * rest of the system never has to juggle two shapes.
   */
  active: z.boolean().optional(),
  email_notifications: z.boolean().optional()
})

function generateBotId(): string {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const db = await getDb()

  const moduleDoc = await db.collection(COLLECTIONS.modules).findOne(
    { _id: new ObjectId(body.module_id) },
    { projection: { _id: 1, source: 1, collection: 1, configSchema: 1, notification: 1 } }
  )
  if (!moduleDoc) {
    throw createError({ statusCode: 404, statusMessage: 'Module not found' })
  }
  const moduleSource = (moduleDoc.source as string | undefined) ?? ''
  const moduleCollection = (moduleDoc.collection as string | undefined) ?? ''
  if (!moduleSource || !moduleCollection) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Module is missing source/collection — reseed or re-upload it'
    })
  }

  const configSchema = (moduleDoc.configSchema as Record<string, unknown> | undefined) ?? EMPTY_CONFIG_SCHEMA
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

  let notification = NOTIFICATION_SCHEMA.parse(
    (moduleDoc.notification as NotificationSpec | undefined) ?? EMPTY_NOTIFICATION
  )
  if (!notification.title || !notification.url) {
    notification = { ...notification, title: notification.title || 'title', url: notification.url || 'url' }
  }

  const now = new Date()
  const bot = {
    id: generateBotId(),
    module_id: body.module_id,
    name: body.name,
    source: moduleSource,
    collection: moduleCollection,
    config: body.config,
    matcher: body.matcher,
    notification,
    status: (body.active ?? true) ? 'active' : 'stopped',
    email_notifications: body.email_notifications ?? true,
    expires_at: null,
    created_at: now
  }

  await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    { $push: { bots: bot } as never }
  )

  // Trigger the initial 24h digest email via the notification service. If
  // the broker is unavailable we roll back the bot insert and surface a
  // 503 — silencing this error once cost hours of "why didn't I get an
  // email?" debugging.
  try {
    await publishBotCreated({
      user_id: user._id.toHexString(),
      bot_id: bot.id,
      created_at: now.toISOString()
    })
  } catch (err) {
    console.error('[bots.post] publish bot.created failed, rolling back:', err)
    await db.collection(COLLECTIONS.users).updateOne(
      { _id: user._id },
      { $pull: { bots: { id: bot.id } } as never }
    )
    throw createError({
      statusCode: 503,
      statusMessage: 'Unable to queue initial digest email. Is the notification broker reachable?'
    })
  }

  return {
    ...bot,
    expires_at: null,
    created_at: now.toISOString()
  }
})
