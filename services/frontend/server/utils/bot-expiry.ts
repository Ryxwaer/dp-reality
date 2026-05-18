import type { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'

export const BOT_EXPIRES_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function nextBotExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + BOT_EXPIRES_TTL_MS)
}

export async function bumpExpiresAt(userId: ObjectId): Promise<void> {
  const db = await getDb()
  await db.collection(COLLECTIONS.users).updateOne(
    { _id: userId, 'bots.status': 'active' },
    { $set: { 'bots.$[bot].expires_at': nextBotExpiry() } },
    { arrayFilters: [{ 'bot.status': 'active' }] }
  )
}
