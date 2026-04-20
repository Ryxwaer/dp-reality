import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

// Soft-delete: bot stays in users.bots[] so past notifications resolve.
export default defineEventHandler(async (event) => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bot id required' })
  }

  const db = await getDb()
  const result = await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    {
      $set: {
        'bots.$[bot].status': 'deleted',
        'bots.$[bot].email_notifications': false
      },
      $unset: { 'bots.$[bot].active': '' }
    },
    {
      arrayFilters: [{ 'bot.id': id, 'bot.status': { $ne: 'deleted' } }]
    }
  )

  if (result.modifiedCount === 0) {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }

  return { ok: true }
})
