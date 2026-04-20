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
  clientPromise = client.connect()
  return clientPromise
}

export async function getDb(): Promise<Db> {
  const client = await getClient()
  return client.db()
}

export const COLLECTIONS = {
  users: 'users',
  notifications: 'notifications',
  modules: 'modules'
} as const

export async function getListingCollections(db: Db): Promise<string[]> {
  const names = await db.collection(COLLECTIONS.modules).distinct('collection') as string[]
  return names.filter(n => typeof n === 'string' && n.length > 0)
}
