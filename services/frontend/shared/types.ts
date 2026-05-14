// Shared platform types. These mirror the contract documented in
// chapters/03-architecture-design.tex (database design + service composition).
//
// Anything specific to an individual bot service (matcher dialect,
// notification template, source-specific listing tail) is OWNED by that
// bot service and is NOT modelled here. The BFF only knows the metadata
// it stores in users.bots[] and the cross-cutting collections.

export const BOT_STATUSES = ['pending', 'active', 'stopped', 'deleted'] as const
export type BotStatus = typeof BOT_STATUSES[number]

/**
 * Per-configuration metadata held by the BFF inside users.bots[].
 *
 * `config_id` identifies one user-owned configuration of a bot service.
 * It is also the `_id` of the corresponding row in the owning bot
 * service's <service>_config collection.
 *
 * `bot_id` identifies the bot service type itself (the same string a
 * bot service publishes as its module_registry key — in compose / k8s
 * it is also the Service / DNS name, e.g. "bot-bazos").
 *
 * `status: "pending"` is the provisional state held while the user is
 * filling in the iframe of the bot-creation wizard. The janitor sweeps
 * pending entries that never flipped to "active" within a short TTL,
 * and any matching <bot>_config row gets deleted as part of the same
 * sweep.
 */
export interface BotMeta {
  config_id: string
  bot_id: string
  name: string
  status: BotStatus
  email_notifications: boolean
  created_at: string
  /** Visit-to-refresh expiry (FR-02-B). `null` while the row is still
   *  provisional (status='pending') and after a terminal `deleted`
   *  state; otherwise the daily sweep flips `active` rows past this
   *  timestamp to `stopped`. */
  expires_at: string | null
}

/** module_registry document — one per advertised bot service.
 *
 * Self-registration is a one-time advertisement on bot-service boot.
 * Once listed, the row stays put: there is no heartbeat field and no
 * unregistration path. `category` is a free-form slug
 * ("real-estate", "marketplace", "jobs", …) that the BFF uses to
 * group services in the /store marketplace view; everything else is
 * opaque human-readable metadata.
 */
export interface ModuleRegistryEntry {
  bot_id: string
  display_name: string
  description: string
  base_url: string
  category: string
  /** Path under base_url where the bot serves its iframe configuration
   *  page. The BFF reads this when assembling the iframe src. */
  configure_url: string
  /** Mongo collection holding this bot's per-configuration documents.
   *  The BFF mutates `active` and deletes rows here directly when the
   *  user pauses, resumes, or removes a bot. */
  config_collection: string
}

/**
 * Notifications inbox row — written by bot services (one per matched
 * listing per user per bot service), read by the BFF (inbox UI) and by
 * the email notifier (envelope assembly). The composite unique index
 * `(user_id, bot_id, source_ref)` collapses multiple matching configs
 * of the same user/bot into a single row; `config_ids[]` is the set of
 * the user's configurations that flagged the listing.
 */
export interface NotificationDoc {
  id: string
  user_id: string
  bot_id: string
  config_ids: string[]
  source_ref: string
  title: string
  url: string
  /** Server-sanitised HTML card; safe to v-html on the client. */
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
