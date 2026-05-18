import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

const schema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().toLowerCase().email().optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, schema.parse)

  const update: Record<string, unknown> = {}
  if (body.name && body.name !== user.name) update.name = body.name
  if (body.email && body.email !== user.email) update.email = body.email

  if (Object.keys(update).length === 0) {
    return { ok: true, updated: false }
  }

  const db = await getDb()

  if (update.email) {
    const existing = await db
      .collection(COLLECTIONS.users)
      .findOne({ email: update.email, _id: { $ne: user._id } })
    if (existing) {
      throw createError({ statusCode: 409, statusMessage: 'Email already in use' })
    }
  }

  await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    { $set: update }
  )

  return { ok: true, updated: true }
})
