import { getDb, COLLECTIONS } from '../utils/db'

/**
 * Nitro startup plugin: ensures MongoDB indexes exist for the collections
 * the frontend BFF *owns* — `users` and `modules`.
 *
 * Per-source listing collections (`bazos`, `sreality`, …) are owned by
 * their respective scrapers and `notifications` is owned by the
 * notification service, so those are deliberately not touched here. The
 * frontend is free to read from and (for the inbox's mark-as-read flow)
 * write to `notifications`, but it does not gate on its schema.
 */
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
