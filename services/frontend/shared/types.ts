export const BOT_STATUSES = ['pending', 'active', 'stopped', 'deleted'] as const
export type BotStatus = typeof BOT_STATUSES[number]

export interface BotMeta {
  config_id: string
  bot_id: string
  name: string
  status: BotStatus
  email_notifications: boolean
  created_at: string
  expires_at: string | null
}

export interface ModuleRegistryEntry {
  bot_id: string
  display_name: string
  description: string
  base_url: string
  category: string
  configure_url: string
  config_collection: string
}

export interface NotificationDoc {
  id: string
  user_id: string
  bot_id: string
  config_ids: string[]
  source_ref: string
  title: string
  url: string
  html: string
  created_at: string
  unread: boolean
  sent_at: string | null
}

export interface UserPreferences {
  email_enabled: boolean
  weekly_digest: boolean
  important_updates: boolean
}

export interface UserDoc {
  id: string
  email: string
  name: string
  created_at: string
  bots: BotMeta[]
  preferences: UserPreferences
}

export interface SessionUser {
  id: string
  email: string
  name: string
}

export interface Stat {
  title: string
  icon: string
  value: number | string
}
