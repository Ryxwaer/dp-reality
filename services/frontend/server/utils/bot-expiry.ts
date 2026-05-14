import type { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'

// Visit-to-refresh TTL for users.bots[].expires_at (FR-02-B, thesis
// Chapter 3 line 597). A bot row is set to `now + BOT_EXPIRES_TTL_MS`
// on every promotion to `active` and on every successful user login;
// the daily expiration sweep (deferred — see /home/ryxwaer/Documents/
// projects/dp-doc/TODO.md item 2) flips rows past this timestamp back
// to `stopped` so the user must re-confirm to resume.
export const BOT_EXPIRES_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function nextBotExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + BOT_EXPIRES_TTL_MS)
}

// Push `expires_at` forward on every active bot of `userId`. Provisional
// (`pending`), stopped, and deleted rows are left untouched; resuming a
// stopped bot bumps its expiry via PATCH /api/bots/:id, not this path.
export async function bumpExpiresAt(userId: ObjectId): Promise<void> {
  const db = await getDb()
  await db.collection(COLLECTIONS.users).updateOne(
    { _id: userId, 'bots.status': 'active' },
    { $set: { 'bots.$[bot].expires_at': nextBotExpiry() } },
    { arrayFilters: [{ 'bot.status': 'active' }] }
  )
}
