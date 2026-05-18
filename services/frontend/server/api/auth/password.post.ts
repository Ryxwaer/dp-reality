import { compare, hash } from 'bcryptjs'
import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { rotateCsrfToken } from '~~/server/utils/session'

const schema = z.object({
  current: z.string().min(1),
  new: z.string().min(8, 'At least 8 characters').max(128)
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, schema.parse)

  if (body.current === body.new) {
    throw createError({ statusCode: 400, statusMessage: 'Passwords must be different' })
  }

  const user = await requireUser(event)

  const ok = await compare(body.current, user.password_hash)
  if (!ok) {
    throw createError({ statusCode: 401, statusMessage: 'Current password is incorrect' })
  }

  const password_hash = await hash(body.new, 12)

  const db = await getDb()
  await db
    .collection(COLLECTIONS.users)
    .updateOne({ _id: user._id }, { $set: { password_hash } })

  await rotateCsrfToken(event)

  return { ok: true }
})
