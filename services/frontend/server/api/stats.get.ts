import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import type { StoredBot } from '~~/server/utils/auth'

interface StatsResponse {
  active_bots: number
  paused_bots: number
  total_matches: number
  unread_matches: number
}

// Home dashboard stats. The BFF doesn't query bot-owned listing
// collections (those are encapsulated by their bot service), so we
// surface what we own: notification counts and the user's bot roster.
export default defineEventHandler(async (event): Promise<StatsResponse> => {
  const user = await requireUser(event)
  const db = await getDb()

  // Bot services persist `user_id` as a hex string into `notifications`,
  // so query that collection by the same string form rather than the
  // canonical ObjectId stored on the user document itself.
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
