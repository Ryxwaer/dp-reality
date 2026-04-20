import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { shapeBot, type RawBot } from '~~/server/utils/bot-shape'
import { verifyUnsubscribeToken } from '~~/server/utils/unsubscribe-token'
import { sourceLabel } from '~~/shared/source'

export interface UnsubscribeBot {
  id: string
  name: string
  module_id: string
  module_name: string | null
  source_key: string
  source_label: string
  status: 'active' | 'stopped'
  email_notifications: boolean
}

export interface UnsubscribeSummary {
  email: string
  source_key: string
  source_label: string
  same_source: UnsubscribeBot[]
  other_sources: Array<{
    source_key: string
    source_label: string
    bots: UnsubscribeBot[]
  }>
}

interface ModuleDocRow {
  _id: ObjectId
  name?: string
  source?: string
  collection?: string
}

export default defineEventHandler(async (event): Promise<UnsubscribeSummary> => {
  const token = getRouterParam(event, 'token')
  if (!token) {
    throw createError({ statusCode: 400, statusMessage: 'Token required' })
  }
  const { unsubscribeSecret } = useRuntimeConfig()
  const verified = verifyUnsubscribeToken(token, unsubscribeSecret)
  if (!verified.ok || !verified.payload) {
    const reason = verified.reason ?? 'invalid'
    throw createError({
      statusCode: 401,
      statusMessage: `Unsubscribe link is ${reason === 'expired' ? 'expired' : 'invalid'}`
    })
  }
  const { uid, src } = verified.payload

  if (!ObjectId.isValid(uid)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad token payload' })
  }

  const db = await getDb()
  const user = await db.collection(COLLECTIONS.users).findOne(
    { _id: new ObjectId(uid) },
    { projection: { email: 1, bots: 1 } }
  )
  if (!user) {
    throw createError({ statusCode: 404, statusMessage: 'Account not found' })
  }

  const rawBots = ((user.bots ?? []) as RawBot[]).map(shapeBot)
    .filter(b => b.status !== 'deleted') as Array<ReturnType<typeof shapeBot>>

  const moduleIds = Array.from(new Set(rawBots.map(b => b.module_id).filter(v => ObjectId.isValid(v))))
  const moduleDocs = moduleIds.length === 0
    ? []
    : await db.collection<ModuleDocRow>(COLLECTIONS.modules).find(
        { _id: { $in: moduleIds.map(id => new ObjectId(id)) } },
        { projection: { name: 1, source: 1, collection: 1 } }
      ).toArray()

  const moduleByID = new Map<string, ModuleDocRow>()
  for (const m of moduleDocs) {
    moduleByID.set(m._id.toHexString(), m)
  }

  const summarise = (bot: ReturnType<typeof shapeBot>): UnsubscribeBot => {
    const mod = moduleByID.get(bot.module_id)
    const key = bot.source || mod?.source || mod?.collection || 'unknown'
    return {
      id: bot.id,
      name: bot.name,
      module_id: bot.module_id,
      module_name: mod?.name ?? null,
      source_key: key,
      source_label: sourceLabel(key),
      status: bot.status === 'active' ? 'active' : 'stopped',
      email_notifications: bot.email_notifications
    }
  }

  const summaries = rawBots.map(summarise)

  const same = summaries.filter(b => b.source_key === src)
  const others = summaries.filter(b => b.source_key !== src)

  const grouped = new Map<string, UnsubscribeBot[]>()
  for (const b of others) {
    const bucket = grouped.get(b.source_key) ?? []
    bucket.push(b)
    grouped.set(b.source_key, bucket)
  }
  const other_sources = [...grouped.entries()]
    .map(([key, bots]) => ({
      source_key: key,
      source_label: sourceLabel(key),
      bots
    }))
    .sort((a, b) => a.source_label.localeCompare(b.source_label))

  return {
    email: user.email as string,
    source_key: src,
    source_label: sourceLabel(src),
    same_source: same,
    other_sources
  }
})
