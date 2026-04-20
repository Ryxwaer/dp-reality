import { MongoClient, type Db } from 'mongodb'

let clientPromise: Promise<MongoClient> | null = null

/**
 * Lazily creates and memoizes a single MongoClient for the server process.
 * The connection string must be provided via NUXT_MONGODB_URI.
 */
function getClient(): Promise<MongoClient> {
  if (clientPromise) {
    return clientPromise
  }

  const { mongodbUri } = useRuntimeConfig()
  if (!mongodbUri) {
    throw createError({
      statusCode: 500,
      statusMessage: 'MongoDB URI is not configured (NUXT_MONGODB_URI).'
    })
  }

  const client = new MongoClient(mongodbUri)
  clientPromise = client.connect()
  return clientPromise
}

/**
 * Returns the default database bound to the configured connection URI.
 * MongoDB picks the database from the URI path segment.
 */
export async function getDb(): Promise<Db> {
  const client = await getClient()
  return client.db()
}

export const COLLECTIONS = {
  users: 'users',
  notifications: 'notifications',
  modules: 'modules'
} as const

/**
 * Per-source listing collections. Each scraper owns its own native
 * schema (`bazos` has `psc` + `description`, `sreality` has `gps` +
 * `labels`) so dashboard stats must union across them.
 *
 * Adding a new scraper is a three-step operation:
 *   1. Add the source's collection name here so stats endpoints and
 *      admin tooling pick it up.
 *   2. Point the module seed at it in `server/utils/seed-modules.ts`.
 *   3. Teach `wipe-and-reseed.mjs` to drop it.
 */
export const LISTING_COLLECTIONS = ['bazos', 'sreality'] as const
