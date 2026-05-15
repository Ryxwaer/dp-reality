import type { Collection, IndexDescription, IndexDirection, Document } from 'mongodb'
import { getDb, COLLECTIONS } from '../utils/db'

type IndexKeySpec = Record<string, IndexDirection>

interface DesiredIndex extends IndexDescription {
  key: IndexKeySpec
  name: string
  unique?: boolean
  expireAfterSeconds?: number
}

// Compare an existing Mongo index keyspec (e.g. { user_id: 1, created_at: -1 })
// to a desired one. Order of fields matters in Mongo, so JSON-stringify with
// stable field iteration is sufficient — both sides come from object literals
// and Mongo preserves insertion order on read.
function sameKeySpec(a: Document, b: IndexKeySpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Idempotent ensure: if an index with the same name already exists but
// points at a different key shape (i.e. it predates a schema change),
// drop it and recreate. This lets the BFF survive legacy DB state
// without forcing a manual migration.
// Mongo error code 26 — NamespaceNotFound. Means the collection
// doesn't exist yet, which happens on a freshly-migrated DB before
// any bot service has registered. createIndexes will materialise it.
const NS_NOT_FOUND = 26

async function ensureIndexes(coll: Collection, desired: DesiredIndex[]): Promise<void> {
  let existing: Document[] = []
  try {
    existing = await coll.indexes()
  } catch (err) {
    if ((err as { code?: number }).code !== NS_NOT_FOUND) throw err
  }

  const byName = new Map<string, Document>(existing.map(idx => [idx.name as string, idx]))
  const desiredNames = new Set(desired.map(d => d.name))

  for (const want of desired) {
    const have = byName.get(want.name)
    if (have && !sameKeySpec(have.key, want.key)) {
      console.warn(
        `[indexes] dropping legacy index ${coll.collectionName}.${want.name}: ` +
        `key ${JSON.stringify(have.key)} -> ${JSON.stringify(want.key)}`
      )
      await coll.dropIndex(want.name)
      byName.delete(want.name)
    }

    // Mongoose / other writers can auto-create indexes with their own
    // names (e.g. `service_1`) on keys we own. Drop those so our named
    // declaration wins — the BFF is the source of truth for indexes
    // on collections it owns.
    for (const [name, idx] of byName) {
      if (name === '_id_') continue
      if (desiredNames.has(name)) continue
      if (sameKeySpec(idx.key, want.key)) {
        console.warn(
          `[indexes] dropping foreign auto-index ${coll.collectionName}.${name} ` +
          `(same key as ${want.name})`
        )
        await coll.dropIndex(name)
        byName.delete(name)
      }
    }
  }

  await coll.createIndexes(desired)
}

export default defineNitroPlugin(async () => {
  const db = await getDb()

  await ensureIndexes(db.collection(COLLECTIONS.users), [
    { key: { email: 1 }, name: 'email_unique', unique: true }
  ])

  await ensureIndexes(db.collection(COLLECTIONS.moduleRegistry), [
    { key: { bot_id: 1 }, name: 'bot_id_unique', unique: true }
  ])

  // The unique notifications index is owned by bot services (they
  // create it on boot). We declare it here too so a fresh BFF on a
  // pristine DB doesn't race them.
  await ensureIndexes(db.collection(COLLECTIONS.notifications), [
    {
      key: { user_id: 1, bot_id: 1, source_ref: 1 },
      name: 'user_bot_source_unique',
      unique: true
    },
    { key: { user_id: 1, created_at: -1 }, name: 'user_recent' },
    { key: { user_id: 1, unread: 1 }, name: 'user_unread' }
  ])

  // `sessions` is the Mongo-backed session store that replaces the
  // previous cookie-encrypted state. The TTL index lets Mongo reap
  // expired rows on its own (≤ 60 s sweep), so a forgotten browser
  // doesn't keep a credential alive past `expires_at`.
  await ensureIndexes(db.collection(COLLECTIONS.sessions), [
    { key: { user_id: 1 }, name: 'user_id' },
    { key: { expires_at: 1 }, name: 'expires_at_ttl', expireAfterSeconds: 0 }
  ])
})
