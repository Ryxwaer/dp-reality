import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { findRegistryEntry } from '~~/server/utils/registry'
import { verifyUnsubscribeToken } from '~~/server/utils/unsubscribe-token'
import type { StoredBot } from '~~/server/utils/auth'

const botUpdateSchema = z.object({
  config_id: z.string().min(1).max(64),
  email_notifications: z.boolean().optional(),
  status: z.enum(['active', 'stopped']).optional()
}).refine(
  v => v.email_notifications !== undefined || v.status !== undefined,
  { message: 'Per-config update must contain email_notifications or status' }
)

const bodySchema = z.object({
  updates: z.array(botUpdateSchema).min(1).max(500)
})

export default defineEventHandler(async (event) => {
  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Token required' })
  }

  const { unsubscribeSecret } = useRuntimeConfig()
  const verified = verifyUnsubscribeToken(token, unsubscribeSecret)
  if (!verified.ok || !verified.payload) {
    throw createError({
      statusCode: 401,
      statusMessage: verified.reason === 'expired'
        ? 'Unsubscribe link expired'
        : 'Invalid unsubscribe link'
    })
  }
  const { uid } = verified.payload

  if (!ObjectId.isValid(uid)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad token payload' })
  }

  const body = await readValidatedBody(event, bodySchema.parse)
  const userObjectID = new ObjectId(uid)

  const db = await getDb()
  const users = db.collection(COLLECTIONS.users)

  const userDoc = await users.findOne(
    { _id: userObjectID },
    { projection: { bots: 1 } }
  )
  const botMap = new Map<string, StoredBot>()
  for (const b of ((userDoc?.bots ?? []) as StoredBot[])) {
    botMap.set(b.config_id, b)
  }

  let applied = 0
  for (const u of body.updates) {
    if (u.status !== undefined) {
      const bot = botMap.get(u.config_id)
      if (bot) {
        const registry = await findRegistryEntry(bot.bot_id)
        if (registry && registry.config_collection) {
          await db.collection(registry.config_collection).updateOne(
            { _id: u.config_id as never },
            { $set: { active: u.status === 'active' } }
          )
        }
      }
    }

    const set: Record<string, unknown> = {}
    if (u.email_notifications !== undefined) {
      set['bots.$[bot].email_notifications'] = u.email_notifications
    }
    if (u.status !== undefined) {
      set['bots.$[bot].status'] = u.status
    }

    const res = await users.updateOne(
      { _id: userObjectID },
      { $set: set },
      { arrayFilters: [{ 'bot.config_id': u.config_id, 'bot.status': { $ne: 'deleted' } }] }
    )
    applied += res.modifiedCount
  }

  return { ok: true, applied }
})
