import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { findRegistryEntry } from '~~/server/utils/registry'
import type { StoredBot } from '~~/server/utils/auth'

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
