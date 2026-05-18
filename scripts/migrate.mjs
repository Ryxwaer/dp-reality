#!/usr/bin/env node
import process from 'node:process'
import { MongoClient } from 'mongodb'

const URI = process.env.NUXT_MONGODB_URI || process.env.MONGODB_URI
if (!URI) {
  console.error('[migrate] missing NUXT_MONGODB_URI / MONGODB_URI')
  process.exit(1)
}

if (process.env.NODE_ENV === 'production' && process.env.FORCE_MIGRATE !== '1') {
  console.error('[migrate] refusing to run in production without FORCE_MIGRATE=1')
  process.exit(1)
}

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  const db = client.db()

  console.log(`[migrate] dropping database ${db.databaseName}`)
  await db.dropDatabase()
  console.log('[migrate] done. Boot the bot services and the BFF next.')

  await client.close()
}

main().catch((err) => {
  console.error('[migrate] fatal', err)
  process.exit(1)
})
