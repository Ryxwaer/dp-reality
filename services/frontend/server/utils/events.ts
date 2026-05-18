export const EXCHANGES = {
  notifyBotProcessed: 'notify.bot.processed'
} as const

export interface NotifyBotProcessedEvent {
  user_id: string
  bot_id: string
  run_id: string
}
