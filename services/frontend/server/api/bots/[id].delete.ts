import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { findRegistryEntry } from '~~/server/utils/registry'
import type { StoredBot } from '~~/server/utils/auth'

// Delete a configuration. The BFF resolves the bot's config collection
// from module_registry.config_collection, drops the row directly,
// then updates users.bots[]:
//
//   - committed bots (status = 'active' | 'stopped') are soft-deleted
//     so historical notifications keep resolving the bot's name;
//   - provisional rows (status = 'pending') are hard-pulled because
//     there are no historical notifications to preserve and we don't
//     want orphans accumulating in users.bots[].
//
// Order matters: drop the bot-owned row first so the matcher stops
// producing notifications even if the second write fails.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const configId = getRouterParam(event, 'id')
  if (!configId) {
    throw createError({ statusCode: 400, statusMessage: 'config_id required' })
  }

  const bots = (user.bots ?? []) as StoredBot[]
  const existing = bots.find(b => b.config_id === configId)
  if (!existing || existing.status === 'deleted') {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }

  const db = await getDb()

  const registry = await findRegistryEntry(existing.bot_id)
  if (registry && registry.config_collection) {
    await db.collection(registry.config_collection).deleteOne({ _id: configId as never })
  }
  // Note: a missing registry entry (e.g. bot service was de-registered
  // before this delete) leaves any orphan <bot>_config row behind. The
  // janitor's orphan sweep will pick it up on the next pass.

  if (existing.status === 'pending') {
    await db.collection(COLLECTIONS.users).updateOne(
      { _id: user._id },
      { $pull: { bots: { config_id: configId } } as never }
    )
  } else {
    await db.collection(COLLECTIONS.users).updateOne(
      { _id: user._id },
      {
        $set: {
          'bots.$[bot].status': 'deleted',
          'bots.$[bot].email_notifications': false
        }
      },
      { arrayFilters: [{ 'bot.config_id': configId, 'bot.status': { $ne: 'deleted' } }] }
    )
  }

  return { ok: true }
})
