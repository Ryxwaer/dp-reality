import { proxyToModule } from '~~/server/utils/module-proxy'

export default defineEventHandler(async (event) => {
  const botId = getRouterParam(event, 'bot_id') ?? ''
  const rest = getRouterParam(event, 'path') ?? ''
  return proxyToModule(event, botId, '/' + rest)
})
