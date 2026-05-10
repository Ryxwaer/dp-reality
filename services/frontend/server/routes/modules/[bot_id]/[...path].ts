import { proxyToModule } from '~~/server/utils/module-proxy'

/**
 * Catch-all reverse proxy for module access. Browser-side JS in a bot
 * service's configure.html (loaded inside the BFF iframe) calls
 * /modules/<bot_id>/configs/<config_id> and /modules/<bot_id>/parse-url
 * on the BFF origin; this route forwards them verbatim to the resolved
 * base_url for that bot service. The BFF stays the single hostname
 * exposed to the user; bot services never need a public DNS entry.
 */
export default defineEventHandler(async (event) => {
  const botId = getRouterParam(event, 'bot_id') ?? ''
  const rest = getRouterParam(event, 'path') ?? ''
  return proxyToModule(event, botId, '/' + rest)
})
