import type { Collection, IndexDescription, IndexDirection, Document } from 'mongodb'
import { getDb, COLLECTIONS } from '../utils/db'

type IndexKeySpec = Record<string, IndexDirection>

interface DesiredIndex extends IndexDescription {
  key: IndexKeySpec
  name: string
  unique?: boolean
  expireAfterSeconds?: number
}

function sameKeySpec(a: Document, b: IndexKeySpec): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

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

  await ensureIndexes(db.collection(COLLECTIONS.notifications), [
    {
      key: { user_id: 1, bot_id: 1, source_ref: 1 },
      name: 'user_bot_source_unique',
      unique: true
    },
    { key: { user_id: 1, created_at: -1 }, name: 'user_recent' },
    { key: { user_id: 1, unread: 1 }, name: 'user_unread' }
  ])

  await ensureIndexes(db.collection(COLLECTIONS.sessions), [
    { key: { user_id: 1 }, name: 'user_id' },
    { key: { expires_at: 1 }, name: 'expires_at_ttl', expireAfterSeconds: 0 }
  ])
})
