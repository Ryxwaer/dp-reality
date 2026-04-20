import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

const schema = z.object({
  email_enabled: z.boolean().optional(),
  weekly_digest: z.boolean().optional(),
  important_updates: z.boolean().optional()
})

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, schema.parse)

  const current = user.preferences ?? {
    email_enabled: true,
    weekly_digest: false,
    important_updates: true
  }

  const next = { ...current, ...body }

  const db = await getDb()
  await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    { $set: { preferences: next } }
  )

  return { ok: true, preferences: next }
})
