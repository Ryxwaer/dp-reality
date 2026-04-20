import { z } from 'zod'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, LISTING_COLLECTIONS } from '~~/server/utils/db'

const querySchema = z.object({
  start: z.string(),
  end: z.string(),
  period: z.enum(['daily', 'weekly', 'monthly']).default('daily')
})

const DATE_FORMAT: Record<'daily' | 'weekly' | 'monthly', string> = {
  daily: '%Y-%m-%d',
  weekly: '%G-W%V',
  monthly: '%Y-%m'
}

interface SeriesPoint {
  bucket: string
  count: number
}

export default defineEventHandler(async (event): Promise<SeriesPoint[]> => {
  // Auth is not strictly required (listings are global), but we still gate
  // the endpoint so unauthenticated clients cannot hammer the DB.
  await requireUserId(event)

  const { start, end, period } = await getValidatedQuery(event, querySchema.parse)

  const startDate = new Date(start)
  const endDate = new Date(end)
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid date range' })
  }

  const db = await getDb()

  // Union the per-source collections into a single listings series.
  // The base query runs on the first collection; every additional
  // collection is folded in via `$unionWith` before the shared
  // group/sort stages.
  const [firstCollection, ...restCollections] = LISTING_COLLECTIONS
  if (!firstCollection) return []

  const matchStage = { $match: { first_seen: { $gte: startDate, $lte: endDate } } }
  const unions = restCollections.map(name => ({
    $unionWith: { coll: name, pipeline: [matchStage] }
  }))

  const docs = await db.collection(firstCollection).aggregate<SeriesPoint>([
    matchStage,
    ...unions,
    {
      $group: {
        _id: {
          $dateToString: { format: DATE_FORMAT[period], date: '$first_seen' }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { _id: 1 } },
    { $project: { _id: 0, bucket: '$_id', count: 1 } }
  ]).toArray()

  return docs
})
