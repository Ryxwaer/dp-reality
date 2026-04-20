import type { BotConfig, BotStatus, ModuleMatcher, NotificationSpec } from '~~/shared/types'
import { BOT_STATUSES } from '~~/shared/types'

/**
 * Raw bot-document shape as stored in `users.bots[]`. We accept the
 * legacy `active?: boolean` field too so that any row that slipped past
 * the one-off migration still reads cleanly. New writes use `status`
 * exclusively.
 *
 * `matcher` and `notification` are snapshots taken when the bot was
 * created; a bot that predates the matcher-rework will be missing both
 * and must be recreated by the user.
 */
export interface RawBot {
  id: string
  module_id?: string
  name: string
  source?: string
  collection?: string
  config?: Record<string, unknown>
  matcher?: ModuleMatcher
  notification?: NotificationSpec
  status?: string
  email_notifications?: boolean
  /** Legacy — only read as fallback when `status` is missing. */
  active?: boolean
  expires_at?: Date | string | null
  created_at?: Date | string | null
}

export function toBotStatus(raw: RawBot): BotStatus {
  if (raw.status && (BOT_STATUSES as readonly string[]).includes(raw.status)) {
    return raw.status as BotStatus
  }
  if (raw.active === true) return 'active'
  if (raw.active === false) return 'stopped'
  return 'active'
}

const EMPTY_MATCHER: ModuleMatcher = { filters: [] }
const EMPTY_NOTIFICATION: NotificationSpec = {
  subject: '',
  title: '',
  url: '',
  fields: []
}

/**
 * Normalise a raw Mongo subdocument into the API-facing BotConfig
 * shape. Single definition so list/get/patch/delete all agree.
 */
export function shapeBot(raw: RawBot): BotConfig {
  return {
    id: raw.id,
    module_id: raw.module_id ?? '',
    name: raw.name,
    source: raw.source ?? '',
    collection: raw.collection ?? '',
    config: raw.config ?? {},
    matcher: raw.matcher ?? EMPTY_MATCHER,
    notification: raw.notification ?? EMPTY_NOTIFICATION,
    status: toBotStatus(raw),
    email_notifications: raw.email_notifications ?? true,
    expires_at: raw.expires_at ? new Date(raw.expires_at).toISOString() : null,
    created_at: raw.created_at ? new Date(raw.created_at).toISOString() : ''
  }
}
