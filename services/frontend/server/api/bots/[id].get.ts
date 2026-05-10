import { requireUser } from '~~/server/utils/auth'
import { shapeBot } from '~~/server/utils/bot-shape'
import type { StoredBot } from '~~/server/utils/auth'
import type { BotMeta } from '~~/shared/types'

export default defineEventHandler(async (event): Promise<BotMeta> => {
  const user = await requireUser(event)
  const configId = getRouterParam(event, 'id')
  if (!configId) {
    throw createError({ statusCode: 400, statusMessage: 'config_id required' })
  }

  const bots = (user.bots ?? []) as StoredBot[]
  const raw = bots.find(b => b.config_id === configId)
  if (!raw || raw.status === 'deleted') {
    throw createError({ statusCode: 404, statusMessage: 'Bot not found' })
  }
  return shapeBot(raw)
})
