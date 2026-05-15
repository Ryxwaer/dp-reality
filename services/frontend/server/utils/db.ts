import { MongoClient, type Db } from 'mongodb'

let clientPromise: Promise<MongoClient> | null = null

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
  // If the very first connect rejects (e.g. transient DNS failure on
  // boot), we MUST drop the cached promise — otherwise every subsequent
  // request keeps awaiting the same rejected promise and never recovers
  // until the process is restarted.
  const promise = client.connect().catch((err) => {
    if (clientPromise === promise) {
      clientPromise = null
    }
    throw err
  })
  clientPromise = promise
  return promise
}

export async function getDb(): Promise<Db> {
  const client = await getClient()
  return client.db()
}

// Cross-cutting collections owned by the BFF + the platform contract.
// Per-source listings_<source> and <source>_config collections are
// owned by their respective bot services and are never touched here.
// (`<source>` is the bot service's chosen short slug — e.g. "bazos",
// "sreality" — independent of `bot_id` in module_registry, which is
// the deployment-level service identifier.)
export const COLLECTIONS = {
  users: 'users',
  notifications: 'notifications',
  moduleRegistry: 'module_registry',
  sessions: 'sessions'
} as const
