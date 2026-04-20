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

export async function requireUserId(event: H3Event): Promise<ObjectId> {
  const { user } = await requireUserSession(event)
  return new ObjectId(user.id)
}
