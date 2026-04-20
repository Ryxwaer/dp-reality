import { getDb, COLLECTIONS } from '../utils/db'

// Index-ensure only runs for the collections the BFF owns (users, modules).
export default defineNitroPlugin(async () => {
  try {
    const db = await getDb()

    await db.collection(COLLECTIONS.users).createIndexes([
      { key: { email: 1 }, name: 'email_unique', unique: true },
      { key: { unsubscribe_token: 1 }, name: 'unsubscribe_token_unique', unique: true, sparse: true }
    ])

    await db.collection(COLLECTIONS.modules).createIndexes([
      { key: { created_at: -1 }, name: 'recent' },
      { key: { uploaded_by: 1 }, name: 'uploader' }
    ])
  } catch (error) {
    console.error('[indexes] failed to ensure indexes:', error)
  }
})
