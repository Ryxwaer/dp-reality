#!/usr/bin/env node
// Dev helper: drop every per-module listing collection plus modules,
// notifications, and the legacy `reality`, then empty users.bots[].
// The next frontend request re-seeds built-ins; the next scraper tick
// re-populates listings. Refuses to run in production without FORCE_WIPE=1.
import process from 'node:process'
import { MongoClient } from 'mongodb'

const URI = process.env.NUXT_MONGODB_URI || process.env.MONGODB_URI
if (!URI) {
  console.error('[wipe-and-reseed] missing NUXT_MONGODB_URI / MONGODB_URI')
  process.exit(1)
}

if (process.env.NODE_ENV === 'production' && process.env.FORCE_WIPE !== '1') {
  console.error('[wipe-and-reseed] refusing to run in production without FORCE_WIPE=1')
  process.exit(1)
}

const ALWAYS_DROP = ['modules', 'notifications', 'reality']

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  const db = client.db()

  console.log(`[wipe-and-reseed] using db ${db.databaseName}`)

  const moduleCollections = await db.collection('modules').distinct('collection')
  const toDrop = [...new Set([...ALWAYS_DROP, ...moduleCollections.filter(c => typeof c === 'string' && c)])]

  for (const name of toDrop) {
    try {
      const existed = await db.listCollections({ name }).hasNext()
      if (!existed) {
        console.log(`[wipe-and-reseed]   ${name}: did not exist, skipping`)
        continue
      }
      await db.collection(name).drop()
      console.log(`[wipe-and-reseed]   ${name}: dropped`)
    } catch (err) {
      console.error(`[wipe-and-reseed]   ${name}: drop failed`, err)
    }
  }

  const users = db.collection('users')
  const userCount = await users.countDocuments({})
  if (userCount > 0) {
    const res = await users.updateMany({}, { $set: { bots: [] } })
    console.log(`[wipe-and-reseed]   users: cleared bots[] on ${res.modifiedCount}/${userCount} users`)
  } else {
    console.log('[wipe-and-reseed]   users: none present')
  }

  await client.close()
  console.log('[wipe-and-reseed] done.')
}

main().catch((err) => {
  console.error('[wipe-and-reseed] fatal', err)
  process.exit(1)
})
