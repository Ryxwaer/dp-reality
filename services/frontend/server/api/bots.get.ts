import { requireUser } from '~~/server/utils/auth'
import { shapeBot, type RawBot } from '~~/server/utils/bot-shape'
import type { BotConfig } from '~~/shared/types'

/**
 * Returns the current user's non-deleted bot configurations. Soft-
 * deleted bots (`status === 'deleted'`) are kept in Mongo so historical
 * notifications still resolve their names, but never surface here.
 */
export default defineEventHandler(async (event): Promise<BotConfig[]> => {
  const user = await requireUser(event)
  const bots = (user.bots ?? []) as RawBot[]
  return bots
    .map(shapeBot)
    .filter(b => b.status !== 'deleted')
})
