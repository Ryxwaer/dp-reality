import type { H3Event } from 'h3'
import { ObjectId, type WithId, type Document } from 'mongodb'
import { getDb, COLLECTIONS } from './db'
import type { BotMeta } from '~~/shared/types'

// Per-configuration metadata as persisted inside users.bots[]. `BotMeta`
// is the outward shape; here we allow Date|string for `created_at` so
// the raw Mongo document decodes cleanly before normalisation. The two
// identifiers carry distinct meanings:
//   - config_id: per-configuration handle (also _id in <service>_config)
//   - bot_id:    bot service type (compose / k8s service name)
export interface StoredBot extends Omit<BotMeta, 'created_at' | 'expires_at'> {
  created_at: Date | string
  expires_at?: Date | string | null
}

export interface UserRecord extends Document {
  _id: ObjectId
  email: string
  name: string
  password_hash: string
  created_at: Date
  bots?: StoredBot[]
  unsubscribe_token?: string
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

// Bot services treat `user_id` as an opaque hex-string identifier when
// they write to the shared `notifications` collection (and inside their
// own per-service config rows). The BFF must query those documents
// using the same hex form rather than the ObjectId-typed value used in
// the canonical `users` collection.
export async function requireUserIdHex(event: H3Event): Promise<string> {
  const { user } = await requireUserSession(event)
  return user.id
}
