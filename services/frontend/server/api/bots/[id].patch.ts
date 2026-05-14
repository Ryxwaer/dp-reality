import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { findRegistryEntry } from '~~/server/utils/registry'
import { nextBotExpiry } from '~~/server/utils/bot-expiry'
import type { StoredBot } from '~~/server/utils/auth'

const bodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  email_notifications: z.boolean().optional(),
  status: z.enum(['active', 'stopped']).optional()
}).refine(
  v => v.name !== undefined
    || v.email_notifications !== undefined
    || v.status !== undefined,
  { message: 'At least one field must be provided' }
)

// Patch user-owned per-config metadata. Status flips are mirrored
// directly into the owning bot's <bot>_config collection (the BFF
// resolves it via module_registry.config_collection) so the bot's
// matcher loop picks up the change on its next cycle. The two writes
// are sequential — bot first, BFF second — so the bot stops scraping
// at least as early as the dashboard claims it has.
//
// `pending -> active` is the wizard's commit signal: the iframe sent
// `module:saved`, the bot has already inserted its config row with
// `active: true`, and we just have to flip our own cache from
// "pending" to "active".
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const configId = getRouterParam(event, 'id')
  if (!configId) {
    throw createError({ statusCode: 400, statusMessage: 'config_id required' })
  }
  const body = await readValidatedBody(event, bodySchema.parse)

  const bots = (user.bots ?? []) as StoredBot[]
  const existing = bots.find(b => b.config_id === configId)
  if (!existing || existing.status === 'deleted') {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }

  const db = await getDb()

  // 1) Mirror the status into the bot-owned <bot>_config collection
  //    BEFORE the BFF cache, so the bot stops/resumes its matcher at
  //    least as early as the dashboard says it has. Skipped on the
  //    pending->active wizard commit because the bot wrote
  //    `active: true` itself when it created the row.
  if (body.status !== undefined && existing.status !== 'pending') {
    const registry = await findRegistryEntry(existing.bot_id)
    if (!registry || !registry.config_collection) {
      throw createError({ statusCode: 502, statusMessage: 'Bot service unavailable' })
    }
    await db.collection(registry.config_collection).updateOne(
      { _id: configId as never },
      { $set: { active: body.status === 'active' } }
    )
  }

  // 2) Update users.bots[] — the dashboard projection.
  const set: Record<string, unknown> = {}
  if (body.name !== undefined) set['bots.$[bot].name'] = body.name
  if (body.email_notifications !== undefined) {
    set['bots.$[bot].email_notifications'] = body.email_notifications
  }
  if (body.status !== undefined) set['bots.$[bot].status'] = body.status

  // Visit-to-refresh (FR-02-B): every transition INTO `active` from
  // either the provisional `pending` reservation or a `stopped` row
  // stamps a fresh `expires_at`. The daily sweep (deferred) will flip
  // rows whose expiry has passed back to `stopped`.
  if (body.status === 'active' && existing.status !== 'active') {
    set['bots.$[bot].expires_at'] = nextBotExpiry()
  }

  const result = await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    { $set: set },
    { arrayFilters: [{ 'bot.config_id': configId, 'bot.status': { $ne: 'deleted' } }] }
  )
  if (result.matchedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'User not found' })
  }

  return { ok: true }
})
