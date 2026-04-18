import { getDb } from "../utils/db"

export default defineEventHandler(async () => {
  const db = await getDb()

  const [bySource, recentListings, totalListings] = await Promise.all([
    db
      .collection("reality")
      .aggregate([{ $group: { _id: "$source", count: { $sum: 1 } } }])
      .toArray(),

    db
      .collection("reality")
      .find({}, { projection: { title: 1, price: 1, price_type: 1, city: 1, source: 1, url: 1, first_seen: 1 } })
      .sort({ first_seen: -1 })
      .limit(20)
      .toArray(),

    db.collection("reality").countDocuments(),
  ])

  return {
    totalListings,
    bySource: bySource.map((s) => ({ source: s._id as string, count: s.count as number })),
    recentListings: recentListings.map((l) => ({
      id: String(l._id),
      title: l.title,
      price: l.price ?? null,
      priceType: l.price_type,
      city: l.city ?? null,
      source: l.source,
      url: l.url,
      firstSeen: l.first_seen,
    })),
  }
})
