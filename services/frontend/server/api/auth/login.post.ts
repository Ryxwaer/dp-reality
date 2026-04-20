import { compare } from 'bcryptjs'
import { z } from 'zod'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import type { UserRecord } from '~~/server/utils/auth'

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, schema.parse)

  const db = await getDb()
  const doc = await db
    .collection<UserRecord>(COLLECTIONS.users)
    .findOne({ email: body.email })

  if (!doc) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  const ok = await compare(body.password, doc.password_hash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Invalid credentials' })
  }

  await setUserSession(event, {
    user: {
      id: doc._id.toHexString(),
      email: doc.email,
      name: doc.name
    },
    loggedInAt: new Date().toISOString()
  })

  return { ok: true }
})
