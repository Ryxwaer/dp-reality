import type { H3Event } from 'h3'
import { findRegistryEntry, isSafeBotId } from './registry'

/**
 * Resolve a module_registry entry by bot id and return its base URL
 * (with no trailing slash). Throws 404 if the bot is unknown or if
 * the id fails the safety check.
 */
export async function resolveBaseUrl(botId: string): Promise<string> {
  if (!isSafeBotId(botId)) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown bot service' })
  }
  const entry = await findRegistryEntry(botId)
  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown bot service' })
  }
  return entry.base_url.replace(/\/+$/, '')
}

/**
 * Reverse-proxy an arbitrary HTTP request from the user's browser to
 * the resolved base URL. Used by the /modules/[bot_id]/[...path]
 * catch-all so the bot service's own configuration UI (loaded inside
 * the BFF iframe at the BFF's origin) can call back into itself for
 * arbitrary bot-private endpoints — load existing configs, parse a
 * pasted URL, save the form, etc. — without the BFF needing to know
 * what those URLs are or what they do.
 *
 * The proxy is the auth bridge: it requires an authenticated session,
 * resolves the user's hex id from that session, and injects it as a
 * `user_id` query parameter on every forwarded request. Bot services
 * trust `user_id` because it can only have come from this proxy
 * (their own ports are not publicly reachable). They do NOT trust any
 * `user_id` arriving in a body or query — clients can forge those.
 */
export async function proxyToModule(
  event: H3Event,
  botId: string,
  path: string
): Promise<Response> {
  const base = await resolveBaseUrl(botId)
  const incoming = event.node.req
  const method = (incoming.method ?? 'GET').toUpperCase()

  // Authenticate. /modules/<bot_id>/* is for in-iframe browser calls
  // from a logged-in user; an unauthenticated request has no business
  // talking to a private bot endpoint.
  let userIdHex: string
  try {
    const { user } = await requireUserSession(event)
    userIdHex = user.id
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

  // Forward the original query string but replace user_id with the
  // authenticated session value (drop whatever the client sent).
  const query = getQuery(event)
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (k === 'user_id') continue
    if (Array.isArray(v)) v.forEach(x => x !== undefined && search.append(k, String(x)))
    else if (v !== undefined) search.set(k, String(v))
  }
  search.set('user_id', userIdHex)
  const url = `${base}${path.startsWith('/') ? '' : '/'}${path}?${search.toString()}`

  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue
    const lower = name.toLowerCase()
    if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue
    if (lower.startsWith('cookie')) continue
    headers[name] = Array.isArray(value) ? value.join(',') : String(value)
  }

  let body: BodyInit | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const raw = await readRawBody(event)
    if (raw !== undefined) body = raw as unknown as BodyInit
  }

  const upstream = await fetch(url, { method, headers, body, redirect: 'manual' })

  // Strip headers the runtime sets itself.
  const responseHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (lower === 'transfer-encoding' || lower === 'connection') return
    if (lower === 'content-encoding') return
    responseHeaders.set(key, value)
  })

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  })
}
