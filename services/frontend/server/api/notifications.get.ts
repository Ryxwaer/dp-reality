import type { ObjectId, Document } from 'mongodb'
import { z } from 'zod'
import { requireUserIdHex } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { sanitizeNotificationHtml } from '~~/server/utils/sanitize-html'
import type { NotificationDoc } from '~~/shared/types'

const querySchema = z.object({
  filter: z.enum(['all', 'unread']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0)
})

interface NotificationRow extends Document {
  _id: ObjectId
  user_id: string
  bot_id: string
  config_ids?: string[]
  source_ref: string
  title: string
  url: string
  html: string
  created_at: Date
  unread: boolean
  sent_at?: Date | null
}

export default defineEventHandler(async (event): Promise<NotificationDoc[]> => {
  const userId = await requireUserIdHex(event)
  const query = await getValidatedQuery(event, querySchema.parse)

  const db = await getDb()
  const filter: Record<string, unknown> = { user_id: userId }
  if (query.filter === 'unread') filter.unread = true

  const docs = await db
    .collection<NotificationRow>(COLLECTIONS.notifications)
    .find(filter)
    .sort({ created_at: -1 })
    .skip(query.offset)
    .limit(query.limit)
    .toArray()

  return docs.map(d => ({
    id: d._id.toHexString(),
    user_id: d.user_id ?? '',
    bot_id: d.bot_id ?? '',
    config_ids: d.config_ids ?? [],
    source_ref: d.source_ref ?? '',
    title: d.title ?? '',
    url: d.url ?? '',
    html: sanitizeNotificationHtml(d.html),
    created_at: d.created_at.toISOString(),
    unread: !!d.unread,
    sent_at: d.sent_at ? d.sent_at.toISOString() : null
  }))
})
