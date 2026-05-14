import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { listRegistry } from '~~/server/utils/registry'
import { shapeBot } from '~~/server/utils/bot-shape'
import { verifyUnsubscribeToken } from '~~/server/utils/unsubscribe-token'
import type { StoredBot } from '~~/server/utils/auth'

export interface UnsubscribeBot {
  config_id: string
  name: string
  bot_id: string
  status: 'active' | 'stopped'
  email_notifications: boolean
}

export interface UnsubscribeServiceGroup {
  bot_id: string
  display_name: string
  bots: UnsubscribeBot[]
}

export interface UnsubscribeSummary {
  email: string
  // The bot service id (e.g. "bot-bazos") whose digest the recipient
  // clicked unsubscribe on. The page uses it to pre-select every
  // matching config's "Disable emails" checkbox. `null` when the
  // token was minted without a bid claim (older email-notifier build,
  // or a non-bot-scoped email path).
  triggered_by_bot_id: string | null
  groups: UnsubscribeServiceGroup[]
}

// Token carries the user id and (optionally) the bot id of the
// digest the user clicked. We list every active bot owned by that
// user, grouped by service; `triggered_by_bot_id` is forwarded as a
// UI hint so the page can pre-select the relevant configs.
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
  const { uid, bid } = verified.payload

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

  const bots = ((user.bots ?? []) as StoredBot[])
    .map(shapeBot)
    .filter(b => b.status !== 'deleted')

  const registry = await listRegistry()
  const displayName = new Map<string, string>()
  for (const r of registry) displayName.set(r.bot_id, r.display_name)

  const groupMap = new Map<string, UnsubscribeBot[]>()
  for (const b of bots) {
    const bucket = groupMap.get(b.bot_id) ?? []
    bucket.push({
      config_id: b.config_id,
      name: b.name,
      bot_id: b.bot_id,
      status: b.status === 'active' ? 'active' : 'stopped',
      email_notifications: b.email_notifications
    })
    groupMap.set(b.bot_id, bucket)
  }

  const groups: UnsubscribeServiceGroup[] = [...groupMap.entries()]
    .map(([botId, items]) => ({
      bot_id: botId,
      display_name: displayName.get(botId) ?? botId,
      bots: items
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  // Surface `bid` only if it actually maps to one of the user's
  // groups — guards against a stale or malformed claim showing a
  // "pre-selected" hint for a bot the user doesn't own.
  const triggeredByBotId = bid && groupMap.has(bid) ? bid : null

  return {
    email: user.email as string,
    triggered_by_bot_id: triggeredByBotId,
    groups
  }
})
