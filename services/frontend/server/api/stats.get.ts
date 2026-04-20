import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS, LISTING_COLLECTIONS } from '~~/server/utils/db'

interface StatsResponse {
  total_listings: number
  new_last_24h: number
  active_bots: number
  unread_matches: number
}

export default defineEventHandler(async (event): Promise<StatsResponse> => {
  const user = await requireUser(event)
  const db = await getDb()

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Each per-source collection is counted in parallel and then summed.
  // Two round-trips is fine for N=2 collections; if N grows beyond
  // ~5 this should move to a `$unionWith`-based single aggregate.
  const listingCountPromises = LISTING_COLLECTIONS.flatMap(name => [
    db.collection(name).countDocuments({}),
    db.collection(name).countDocuments({ first_seen: { $gte: oneDayAgo } })
  ])

  const [listingCounts, unreadMatches] = await Promise.all([
    Promise.all(listingCountPromises),
    db.collection(COLLECTIONS.notifications).countDocuments({
      user_id: user._id,
      unread: true
    })
  ])

  let totalListings = 0
  let newLast24h = 0
  for (let i = 0; i < listingCounts.length; i += 2) {
    totalListings += listingCounts[i] ?? 0
    newLast24h += listingCounts[i + 1] ?? 0
  }

  // `active` was the legacy flag; `status === 'active'` is the new
  // source of truth. Accept both so a rollback of the migration
  // doesn't silently start reporting zero active bots.
  const bots = (user.bots ?? []) as Array<{ status?: string, active?: boolean }>
  const activeBots = bots.filter(b => (b?.status ?? (b?.active ? 'active' : 'stopped')) === 'active').length

  return {
    total_listings: totalListings,
    new_last_24h: newLast24h,
    active_bots: activeBots,
    unread_matches: unreadMatches
  }
})
