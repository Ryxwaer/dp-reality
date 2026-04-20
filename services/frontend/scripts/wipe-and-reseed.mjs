#!/usr/bin/env node
/**
 * Dev-only helper that wipes the collections touched by the bot-owned
 * matcher rework and lets the scraper + seeder rebuild everything
 * from scratch on the next run.
 *
 * Affected collections:
 *   - `modules`        — system seeds are re-inserted automatically the
 *                        next time the frontend lists modules (via
 *                        `ensureSeededModules()`). The seeds now carry
 *                        a `configSchema` instead of a `matcher`.
 *   - `notifications`  — cleared in full. No migration of the old
 *                        listing-shaped rows; the new code assumes the
 *                        resolved-field shape.
 *   - `bazos`,
 *     `sreality`       — per-source listing collections, cleared in
 *                        full so the next scraper tick stamps every
 *                        row with a run_id.
 *   - `reality`        — the legacy pre-per-source collection. Dropped
 *                        if present; harmless if already gone.
 *   - `users`          — every user's `bots` array is emptied (not the
 *                        user itself). Pre-rework bot entries lack the
 *                        `matcher` + `notification` snapshots the Go
 *                        notifier now reads from the bot, so they have
 *                        to be recreated — the user opens their module
 *                        again and re-saves.
 *
 * Intended usage (dev machines only):
 *
 *     NUXT_MONGODB_URI=mongodb://... node scripts/wipe-and-reseed.mjs
 *
 * The script bails out if NODE_ENV === 'production' unless
 * FORCE_WIPE=1 is set.
 */
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

const COLLECTIONS_TO_DROP = ['modules', 'notifications', 'bazos', 'sreality', 'reality']

async function main() {
  const client = new MongoClient(URI)
  await client.connect()
  const db = client.db()

  console.log(`[wipe-and-reseed] using db ${db.databaseName}`)

  for (const name of COLLECTIONS_TO_DROP) {
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
  console.log('[wipe-and-reseed] done. Next frontend request will re-seed built-in modules; next scraper run will re-populate `bazos` / `sreality`.')
}

main().catch((err) => {
  console.error('[wipe-and-reseed] fatal', err)
  process.exit(1)
})
