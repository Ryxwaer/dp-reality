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

export const COLLECTIONS = {
  users: 'users',
  notifications: 'notifications',
  moduleRegistry: 'module_registry',
  sessions: 'sessions'
} as const
