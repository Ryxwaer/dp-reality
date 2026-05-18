import type { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { listRegistry } from '~~/server/utils/registry'
import type { StoredBot } from '~~/server/utils/auth'

interface UserBotsRow {
  _id: ObjectId
  bots?: StoredBot[]
}

const PENDING_TTL_MS = 15 * 60 * 1000
const ORPHAN_TTL_MS = 60 * 60 * 1000

export default defineTask({
  meta: {
    name: 'janitor:provisional-bots',
    description: 'Reap pending users.bots[] rows and orphan <bot>_config rows'
  },
  async run() {
    const now = new Date()
    const db = await getDb()
    const reaped = { pending: 0, orphans: 0 }

    const pendingThreshold = new Date(now.getTime() - PENDING_TTL_MS)
    const candidates = await db.collection<UserBotsRow>(COLLECTIONS.users)
      .find(
        { 'bots.status': 'pending' },
        { projection: { bots: 1 } }
      )
      .toArray()

    const registry = await listRegistry()
    const collectionByBotId = new Map<string, string>()
    for (const r of registry) {
      if (r.config_collection) collectionByBotId.set(r.bot_id, r.config_collection)
    }

    for (const userDoc of candidates) {
      const stale = (userDoc.bots ?? []).filter((b) => {
        if (b.status !== 'pending') return false
        const created = b.created_at instanceof Date
          ? b.created_at
          : new Date(b.created_at as string)
        return created <= pendingThreshold
      })

      for (const bot of stale) {
        const targetCollection = collectionByBotId.get(bot.bot_id)
        if (targetCollection) {
          await db.collection(targetCollection).deleteOne({ _id: bot.config_id as never })
        }
        await db.collection(COLLECTIONS.users).updateOne(
          { _id: userDoc._id },
          { $pull: { bots: { config_id: bot.config_id } } as never }
        )
        reaped.pending += 1
      }
    }

    const claimedIds = await db.collection(COLLECTIONS.users)
      .distinct('bots.config_id') as string[]
    const claimed = new Set<string>(claimedIds.filter(Boolean))

    const orphanThreshold = new Date(now.getTime() - ORPHAN_TTL_MS)
    for (const r of registry) {
      if (!r.config_collection) continue
      const cursor = db.collection(r.config_collection).find(
        { created_at: { $lte: orphanThreshold } },
        { projection: { _id: 1 } }
      )
      for await (const doc of cursor) {
        const id = doc._id as unknown as string
        if (claimed.has(id)) continue
        await db.collection(r.config_collection).deleteOne({ _id: doc._id })
        reaped.orphans += 1
      }
    }

    return { result: { ...reaped, ts: now.toISOString() } }
  }
})
