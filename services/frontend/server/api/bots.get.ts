import { requireUser } from '~~/server/utils/auth'
import { shapeBot } from '~~/server/utils/bot-shape'
import type { StoredBot } from '~~/server/utils/auth'
import type { BotMeta } from '~~/shared/types'

export default defineEventHandler(async (event): Promise<BotMeta[]> => {
  const user = await requireUser(event)
  const bots = (user.bots ?? []) as StoredBot[]
  return bots
    .map(shapeBot)
    .filter(b => b.status !== 'deleted' && b.status !== 'pending')
})
