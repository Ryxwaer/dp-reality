import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'
import { SREALITY_BUNDLE, BAZOS_BUNDLE, type SeedBundle } from '../seeds/generated-bundles'

const SYSTEM_USER_ID = new ObjectId('000000000000000000000000')

interface SeedSpec {
  id: ObjectId
  bundle: SeedBundle
}

const SEEDS: SeedSpec[] = [
  { id: new ObjectId('000000000000000000000001'), bundle: SREALITY_BUNDLE },
  { id: new ObjectId('000000000000000000000002'), bundle: BAZOS_BUNDLE }
]

let ensurePromise: Promise<void> | null = null

async function doSeed(): Promise<void> {
  const db = await getDb()
  let inserted = 0
  let updated = 0

  for (const seed of SEEDS) {
    const { code, manifest } = seed.bundle
    if (!code || !code.length) {
      console.warn(`[seed-modules] skipping ${manifest.name} — empty bundle`)
      continue
    }
    const now = new Date()
    // Developer-owned fields go in $set (repo is source of truth);
    // user-editable fields (description / configSchema / notification)
    // go in $setOnInsert so runtime PATCHes aren't clobbered on boot.
    const res = await db.collection(COLLECTIONS.modules).updateOne(
      { _id: seed.id },
      {
        $set: {
          name: manifest.name,
          collection: manifest.collection,
          source: manifest.source,
          code,
          system: true,
          system_author: 'dp-reality'
        },
        $unset: {
          documentation: '',
          notification_template: '',
          matcher: ''
        },
        $setOnInsert: {
          description: manifest.description,
          configSchema: manifest.configSchema,
          notification: manifest.notification,
          uploaded_by: SYSTEM_USER_ID,
          created_at: now,
          updated_at: now
        }
      },
      { upsert: true }
    )
    if (res.upsertedCount) inserted++
    else if (res.modifiedCount) updated++
  }

  console.log(`[seed-modules] ensured built-ins: ${inserted} inserted, ${updated} refreshed`)
}

export function ensureSeededModules(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doSeed().catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}
