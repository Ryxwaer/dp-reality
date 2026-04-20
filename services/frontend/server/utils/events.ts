import { publishFanout } from './rabbitmq'

// Mirror of services/notification/internal/consumer/consumer.go.
export const EXCHANGES = {
  scrapeCompleted: 'scrape.completed',
  botCreated: 'bot.created'
} as const

export interface BotCreatedEvent {
  user_id: string
  bot_id: string
  created_at: string
}

export async function publishBotCreated(evt: BotCreatedEvent): Promise<void> {
  await publishFanout(EXCHANGES.botCreated, evt)
}
