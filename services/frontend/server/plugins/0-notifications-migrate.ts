import { getDb, COLLECTIONS } from '../utils/db'

const LEGACY_INDEX = 'user_config_source_unique'

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
    'recreating an empty notifications collection.'
  )
  await coll.drop()
})
