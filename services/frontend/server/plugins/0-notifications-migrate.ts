import { getDb, COLLECTIONS } from '../utils/db'

// One-shot, idempotent migration that aligns the `notifications`
// collection with the thesis schema: dedup by (user_id, bot_id,
// source_ref) instead of the legacy (user_id, config_id, source_ref).
//
// Strategy: detect the legacy unique index by name, drop the entire
// collection (and its indexes with it), and let the subsequent
// `indexes.ts` plugin re-create the canonical index set on the empty
// namespace. The TODO authorises wiping the data; bot services
// re-populate notifications on their next scrape cycle.
//
// Plugin filename is prefixed `0-` so it runs ahead of `indexes.ts`.
// On subsequent boots the legacy index is gone and this is a no-op.
const LEGACY_INDEX = 'user_config_source_unique'

// Mongo error code 26 — NamespaceNotFound. Means the collection does
// not exist yet (fresh DB), which is a no-op for us.
const NS_NOT_FOUND = 26

export default defineNitroPlugin(async () => {
  const db = await getDb()
  const coll = db.collection(COLLECTIONS.notifications)

  let indexes
  try {
    indexes = await coll.indexes()
  } catch (err) {
    if ((err as { code?: number }).code === NS_NOT_FOUND) return
    throw err
  }

  const hasLegacy = indexes.some((idx) => idx.name === LEGACY_INDEX)
  if (!hasLegacy) return

  console.warn(
    `[notifications-migrate] dropping legacy index ${LEGACY_INDEX} and ` +
    'recreating an empty notifications collection (data was non-critical ' +
    'per /home/ryxwaer/Documents/projects/dp-doc/TODO.md item 1).'
  )
  await coll.drop()
})
