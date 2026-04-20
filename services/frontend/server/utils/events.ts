import { publishFanout } from './rabbitmq'

/**
 * Exchanges we publish to. Kept in one place so Go/TS sides can't drift.
 * Must stay in sync with `services/notification/internal/consumer/consumer.go`.
 */
export const EXCHANGES = {
  scrapeCompleted: 'scrape.completed',
  botCreated: 'bot.created'
} as const

export interface BotCreatedEvent {
  user_id: string
  bot_id: string
  created_at: string
}

/**
 * Publish a bot.created event so the notification service sends an initial
 * 24h digest email for the freshly created bot. Errors are intentionally
 * propagated — per project policy we fail fast rather than silence broker
 * outages, which are otherwise very hard to diagnose.
 */
export async function publishBotCreated(evt: BotCreatedEvent): Promise<void> {
  await publishFanout(EXCHANGES.botCreated, evt)
}
