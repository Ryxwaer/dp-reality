import { requireUserIdHex } from '~~/server/utils/auth'
import { subscribe } from '~~/server/utils/inbox-bus'

export default defineEventHandler(async (event) => {
  const userId = await requireUserIdHex(event)

  setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'Connection', 'keep-alive')
  setHeader(event, 'X-Accel-Buffering', 'no')
  setResponseStatus(event, 200)

  const res = event.node.res

  const send = (data: unknown, evtName?: string) => {
    if (evtName) res.write(`event: ${evtName}\n`)
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  send({ ok: true, ts: Date.now() }, 'open')

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000)

  const unsub = subscribe(userId, (evt) => {
    send({ bot_id: evt.bot_id, run_id: evt.run_id, ts: evt.ts }, 'inbox.refresh')
  })

  const close = () => {
    clearInterval(heartbeat)
    unsub()
    try { res.end() } catch { /* ignore */ }
  }

  event.node.req.on('close', close)
  event.node.req.on('aborted', close)

  await new Promise<void>(() => {})
})
