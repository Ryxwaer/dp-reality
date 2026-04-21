import type { ObjectId, Document } from 'mongodb'
import { z } from 'zod'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import type { NotificationField } from '~~/shared/types'

const querySchema = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0)
})

interface NotificationRow extends Document {
  _id: ObjectId
  user_id: ObjectId
  bot_id?: string
  // Always a string post-migration: sha256 hex (sreality) or ObjectID hex
  // (legacy bazos / pre-migration sreality, normalized by the notifier).
  listing_id?: string
  source: string
  source_id: string
  run_id?: string
  title: string
  url: string
  fields?: NotificationField[]
  matched_at: Date
  unread: boolean
}

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const db = await getDb()
  const filter: Record<string, unknown> = { user_id: userId }
  if (query.filter === 'unread') {
    filter.unread = true
  }

  const docs = await db
    .collection<NotificationRow>(COLLECTIONS.notifications)
    .find(filter)
    .sort({ matched_at: -1 })
    .skip(query.offset)
    .limit(query.limit)
    .toArray()

  return docs.map(d => ({
    id: d._id.toHexString(),
    user_id: d.user_id.toHexString(),
    bot_id: d.bot_id ?? '',
    listing_id: d.listing_id ?? '',
    source: d.source,
    source_id: d.source_id,
    run_id: d.run_id ?? '',
    title: d.title,
    url: d.url,
    fields: d.fields ?? [],
    matched_at: d.matched_at.toISOString(),
    unread: !!d.unread
  }))
})
