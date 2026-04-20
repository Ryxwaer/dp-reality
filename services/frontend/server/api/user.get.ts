import { requireUser } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = await requireUser(event)

  return {
    id: user._id.toHexString(),
    email: user.email,
    name: user.name,
    created_at: user.created_at.toISOString(),
    preferences: user.preferences ?? {
      email_enabled: true,
      weekly_digest: false,
      important_updates: true
    }
  }
})
