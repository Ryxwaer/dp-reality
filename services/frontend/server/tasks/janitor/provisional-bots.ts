import type { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { listRegistry } from '~~/server/utils/registry'
import type { StoredBot } from '~~/server/utils/auth'

interface UserBotsRow {
  _id: ObjectId
  bots?: StoredBot[]
}

// How long a wizard popup is allowed to stay in flight before we
// reclaim its provisional row. Generous (well past a slow typer) but
// short enough that abandoned tabs do not pile up.
const PENDING_TTL_MS = 15 * 60 * 1000

// How long a bot-side config row may live without a matching
// users.bots[] entry before the orphan sweep deletes it. Must comfortably
// exceed PENDING_TTL_MS so the sweep does not race a legitimate
// pending->active flip.
const ORPHAN_TTL_MS = 60 * 60 * 1000

// Two janitor sweeps run together every 5 minutes:
//
//   1) Pending-bot sweep — `users.bots[]` rows stuck in status:'pending'
//      past PENDING_TTL_MS. These are wizard popups the user never
//      finished. We deleteOne the matching <bot>_config (in case the
//      bot did write a row before module:saved was lost) and $pull the
//      provisional users.bots[] entry.
//
//   2) Orphan-config sweep — `<bot>_config` rows older than ORPHAN_TTL_MS
//      whose `_id` appears in no user's bots[]. These are bot-side
//      writes whose users.bots[] sibling never landed (e.g. the user
//      closed the tab between bot 201 and module:saved). For each
//      registry entry we read the bot's `config_collection` and
//      deleteOne the orphans.
//
// Both rules are idempotent.
export default defineTask({
  meta: {
    name: 'janitor:provisional-bots',
    description: 'Reap pending users.bots[] rows and orphan <bot>_config rows'
  },
  async run() {
    const now = new Date()
    const db = await getDb()
    const reaped = { pending: 0, orphans: 0 }

    // -- 1) Pending users.bots[] sweep ---------------------------------------
    const pendingThreshold = new Date(now.getTime() - PENDING_TTL_MS)
    const candidates = await db.collection<UserBotsRow>(COLLECTIONS.users)
      .find(
        { 'bots.status': 'pending' },
        { projection: { bots: 1 } }
      )
      .toArray()

    // We resolve config_collection per bot_id once for the pass; the
    // registry rarely changes during a janitor tick.
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

    // -- 2) Orphan <bot>_config sweep ----------------------------------------
    // Snapshot every config_id currently claimed by a user. Anything
    // older than ORPHAN_TTL_MS that is NOT in this set is an orphan.
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
