// Event contract shared with the bot services and the email notifier.
//
// Only one direction of traffic flows over RabbitMQ now: bot services
// publish on the notify.bot.* fanout exchanges; the BFF and email
// notifier consume them. Lifecycle commands from the BFF (pause /
// resume / delete / wizard commit) are direct MongoDB writes against
// the bot-owned <bot>_config collection (resolved through
// module_registry.config_collection), not AMQP messages.
export const EXCHANGES = {
  notifyBotProcessed: 'notify.bot.processed'
} as const

export interface NotifyBotProcessedEvent {
  user_id: string
  bot_id: string
  run_id: string
}
