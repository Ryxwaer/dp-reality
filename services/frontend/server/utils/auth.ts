import type { H3Event } from 'h3'
import { ObjectId, type WithId, type Document } from 'mongodb'
import { getDb, COLLECTIONS } from './db'

export interface UserRecord extends Document {
  _id: ObjectId
  email: string
  name: string
  password_hash: string
  created_at: Date
  bots?: unknown[]
  unsubscribe_token: string
  preferences?: {
    email_enabled: boolean
    weekly_digest: boolean
    important_updates: boolean
  }
}

/**
 * Resolves the current session and returns the full Mongo user document.
 * Throws 401 when there is no session or the user was deleted.
 */
export async function requireUser(event: H3Event): Promise<WithId<UserRecord>> {
  const { user } = await requireUserSession(event)

  const db = await getDb()
  const doc = await db.collection<UserRecord>(COLLECTIONS.users).findOne({
    _id: new ObjectId(user.id)
  })

  if (!doc) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, statusMessage: 'Session user not found' })
  }

  return doc
}

/**
 * Convenience accessor for routes that only need the ObjectId of the current user.
 */
export async function requireUserId(event: H3Event): Promise<ObjectId> {
  const { user } = await requireUserSession(event)
  return new ObjectId(user.id)
}
