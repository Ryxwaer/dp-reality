import { requireUser } from '~~/server/utils/auth'
import { shapeBot, type RawBot } from '~~/server/utils/bot-shape'
import type { BotConfig } from '~~/shared/types'

export default defineEventHandler(async (event): Promise<BotConfig> => {
  const user = await requireUser(event)
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Bot id required' })
  }

  const bots = (user.bots ?? []) as RawBot[]
  const raw = bots.find(b => b.id === id)
  if (!raw) {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }
  const bot = shapeBot(raw)
  if (bot.status === 'deleted') {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }
  return bot
})
