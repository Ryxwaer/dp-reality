import { ObjectId } from 'mongodb'
import { z } from 'zod'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { verifyUnsubscribeToken } from '~~/server/utils/unsubscribe-token'

const botUpdateSchema = z.object({
  id: z.string().min(1).max(64),
  email_notifications: z.boolean().optional(),
  /** Only `active` and `stopped` are toggleable here — `deleted` must go through DELETE. */
  status: z.enum(['active', 'stopped']).optional()
}).refine(
  v => v.email_notifications !== undefined || v.status !== undefined,
  { message: 'Per-bot update must contain email_notifications or status' }
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

  // One updateOne per bot-id is safest: arrayFilters can only address
  // one positional path per $set clause, but building fancy aggregation
  // pipelines for what's at most a dozen rows isn't worth the risk.
  let applied = 0
  for (const u of body.updates) {
    const set: Record<string, unknown> = {}
    if (u.email_notifications !== undefined) {
      set['bots.$[bot].email_notifications'] = u.email_notifications
    }
    if (u.status !== undefined) {
      set['bots.$[bot].status'] = u.status
    }
    const unset: Record<string, unknown> = {}
    if (set['bots.$[bot].status'] !== undefined) {
      unset['bots.$[bot].active'] = ''
    }
    const update: Record<string, unknown> = { $set: set }
    if (Object.keys(unset).length > 0) {
      update.$unset = unset
    }
    const res = await users.updateOne(
      { _id: userObjectID },
      update,
      {
        arrayFilters: [{ 'bot.id': u.id, 'bot.status': { $ne: 'deleted' } }]
      }
    )
    applied += res.modifiedCount
  }

  return { ok: true, applied }
})
