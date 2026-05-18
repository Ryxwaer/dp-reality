import type { H3Event } from 'h3'
import { findRegistryEntry, isSafeBotId } from './registry'

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

export async function proxyToModule(
  event: H3Event,
  botId: string,
  path: string
): Promise<Response> {
  const base = await resolveBaseUrl(botId)
  const incoming = event.node.req
  const method = (incoming.method ?? 'GET').toUpperCase()

  let userIdHex: string
  try {
    const { user } = await requireUserSession(event)
    userIdHex = user.id
  } catch {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }

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
