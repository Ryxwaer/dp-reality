import type { BotMeta, BotStatus } from '~~/shared/types'
import { BOT_STATUSES } from '~~/shared/types'
import type { StoredBot } from './auth'

function toStatus(raw: StoredBot): BotStatus {
  if (raw.status && (BOT_STATUSES as readonly string[]).includes(raw.status)) {
    return raw.status as BotStatus
  }
  return 'active'
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function shapeBot(raw: StoredBot): BotMeta {
  return {
    config_id: raw.config_id,
    bot_id: raw.bot_id,
    name: raw.name,
    status: toStatus(raw),
    email_notifications: raw.email_notifications ?? true,
    created_at: toIso(raw.created_at) ?? '',
    expires_at: toIso(raw.expires_at)
  }
}
