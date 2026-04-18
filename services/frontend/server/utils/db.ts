import { MongoClient, type Db } from "mongodb"

let client: MongoClient | null = null

export async function getDb(): Promise<Db> {
  const config = useRuntimeConfig()
  const uri = config.mongodbUri

  if (!uri) {
    throw new Error("MONGODB_URI is not configured")
  }

  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }

  return client.db()
}
