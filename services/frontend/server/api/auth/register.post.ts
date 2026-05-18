import { hash } from 'bcryptjs'
import { z } from 'zod'
import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import type { UserRecord } from '~~/server/utils/auth'

const schema = z.object({
  name: z.string().trim().min(2, 'Too short').max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'At least 8 characters').max(128)
})

function generateUnsubscribeToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, schema.parse)

  const db = await getDb()
  const users = db.collection<UserRecord>(COLLECTIONS.users)

  const existing = await users.findOne({ email: body.email })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Email already registered' })
  }

  const password_hash = await hash(body.password, 12)
  const now = new Date()
  const unsubscribe_token = generateUnsubscribeToken()

  const doc: UserRecord = {
    _id: new ObjectId(),
    email: body.email,
    name: body.name,
    password_hash,
    created_at: now,
    bots: [],
    unsubscribe_token,
    preferences: {
      email_enabled: true,
      weekly_digest: false,
      important_updates: true
    }
  }

  await users.insertOne(doc)

  await setUserSession(event, {
    user: {
      id: doc._id.toHexString(),
      email: doc.email,
      name: doc.name
    },
    loggedInAt: now.toISOString()
  })

  return { ok: true }
})
