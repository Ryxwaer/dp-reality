import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import type { StoredBot } from '~~/server/utils/auth'

interface StatsResponse {
  active_bots: number
  paused_bots: number
  total_matches: number
  unread_matches: number
}

export default defineEventHandler(async (event): Promise<StatsResponse> => {
  const user = await requireUser(event)
  const db = await getDb()

  const userIdHex = user._id.toHexString()
  const [totalMatches, unreadMatches] = await Promise.all([
    db.collection(COLLECTIONS.notifications).countDocuments({ user_id: userIdHex }),
    db.collection(COLLECTIONS.notifications).countDocuments({ user_id: userIdHex, unread: true })
  ])

  const bots = (user.bots ?? []) as StoredBot[]
  const live = bots.filter(b => b.status !== 'deleted')
  const active = live.filter(b => (b.status ?? 'active') === 'active').length
  const paused = live.filter(b => b.status === 'stopped').length

  return {
    active_bots: active,
    paused_bots: paused,
    total_matches: totalMatches,
    unread_matches: unreadMatches
  }
})
