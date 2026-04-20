import { requireUser } from '~~/server/utils/auth'
import { shapeBot, type RawBot } from '~~/server/utils/bot-shape'
import type { BotConfig } from '~~/shared/types'

export default defineEventHandler(async (event): Promise<BotConfig[]> => {
  const user = await requireUser(event)
  const bots = (user.bots ?? []) as RawBot[]
  return bots
    .map(shapeBot)
    .filter(b => b.status !== 'deleted')
})
