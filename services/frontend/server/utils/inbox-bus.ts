export interface InboxEvent {
  user_id: string
  bot_id: string
  run_id: string
  ts: number
}

type Listener = (event: InboxEvent) => void

const listeners = new Map<string, Set<Listener>>()

export function subscribe(userId: string, listener: Listener): () => void {
  const set = listeners.get(userId) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(userId, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(userId)
  }
}

export function publish(event: InboxEvent): void {
  const set = listeners.get(event.user_id)
  if (!set) return
  for (const fn of set) {
    try {
      fn(event)
    } catch (err) {
      console.error('[inbox-bus] listener threw:', err)
    }
  }
}
