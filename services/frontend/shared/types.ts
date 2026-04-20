// Domain and UI types shared between the Nuxt app and server.

// ---------- Domain (mirrors MongoDB collections) ----------

export type PriceType = 'sale' | 'rent' | 'auction' | 'unknown'

export type PropertyType
  = | 'apartment'
    | 'house'
    | 'land'
    | 'commercial'
    | 'other'

/**
 * Lifecycle status of a bot. `deleted` is a soft-delete tombstone so
 * historical notifications can still resolve the bot's name; the API
 * filters these out of normal list/get responses.
 */
export const BOT_STATUSES = ['active', 'stopped', 'deleted'] as const
export type BotStatus = typeof BOT_STATUSES[number]

/**
 * A user-owned bot (entry in users.bots[]). Everything the notification
 * service needs at run time is snapshotted onto the bot at create time:
 *
 *  - `source` / `collection`: lets the consumer prefilter per scrape
 *    event without a module join.
 *  - `matcher`: the compiled filter spec the module's `.mjs` produced
 *    from the user's `config` at save time. The server validates its
 *    shape against MATCHER_SCHEMA; the notifier pushes it down to Mongo
 *    as-is. `config.*` interpolation no longer happens at eval time.
 *  - `notification`: the notification spec copied from the module at
 *    create time. A later module update does not retroactively change
 *    how an existing bot notifies — the user recreates the bot to
 *    pick up new templates.
 *
 * `config` stays on the bot as the raw form state the module UI uses
 * to re-hydrate itself when the user re-opens the edit page. It is
 * never read by the notifier and is validated against
 * `module.configSchema` on save.
 *
 * `email_notifications` is independent of `status`, so a user can keep
 * a bot running (inbox receives matches) while silencing emails.
 */
export interface BotConfig {
  id: string
  module_id: string
  name: string
  source: string
  collection: string
  config: Record<string, unknown>
  matcher: ModuleMatcher
  notification: NotificationSpec
  status: BotStatus
  email_notifications: boolean
  expires_at: string | null
  created_at: string
}

/**
 * Operators a module matcher may use. Deliberately excludes `$where`,
 * `$expr`, and anything that could evaluate code. `exists` maps to
 * `$exists: true`.
 *
 * `contains` is a constrained case-insensitive substring match; the
 * Go compile step emits it as a literal-escaped `$regex` with the
 * `i` option, so modules get text search without being allowed to
 * ship arbitrary regex (which would reopen ReDoS / eval-ish foot-guns).
 *
 * `geo_within` expects a value of shape `{ center: [lon, lat], radius_km }`
 * and compiles to `$geoWithin: { $centerSphere: [[lon, lat], km/6378.1] }`.
 * The collection must have a `2dsphere` index on the target field (the
 * sreality scraper owns its own index on `gps`).
 */
export const FILTER_OPS = [
  'in',
  'nin',
  'eq',
  'ne',
  'exists',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'geo_within'
] as const
export type FilterOp = typeof FILTER_OPS[number]

/**
 * Payload for a `geo_within` filter. `center` is GeoJSON-order
 * `[lon, lat]` (matches `$centerSphere` expectations and the
 * coordinates we persist on listings). `radius_km` is a positive
 * number.
 */
export interface GeoWithinValue {
  center: [number, number]
  radius_km: number
}

/**
 * One predicate in a compiled bot matcher. The module's `.mjs` emits
 * these at bot-save time with concrete values already inlined — there
 * is no run-time `config.*` interpolation. The server validates shape
 * only (op whitelist, field path, value types); matching then happens
 * entirely in Mongo via `specmatcher.Compile` in the Go consumer.
 *
 * `field` is a dotted path on the target collection's document (e.g.
 * `city`, `price`, `meta.tags`). Field names are validated against a
 * safe pattern (no `$`, no `[]`, no leading digit, depth ≤ 4). The
 * operator whitelist is what keeps `$where`, `$regex`, `$expr` out.
 * Which fields are legitimate is the module author's responsibility.
 *
 * Skip semantics: an empty-array `value` on an `in`/`nin` filter is
 * dropped client-side by the module (absent config ⇒ no filter on that
 * axis). The server does not second-guess — it validates the final
 * spec as-is.
 */
export interface ModuleFilterSpec {
  field: string
  op: FilterOp
  value?:
    | string
    | number
    | boolean
    | Array<string | number | boolean>
    | GeoWithinValue
  /**
   * Case-insensitive string compare. Only meaningful for
   * `in`/`nin`/`eq`/`ne`/`contains` — the server schema rejects it on
   * any other op. `contains` treats `ci` as default-true semantically
   * (regex is always emitted with the `i` flag).
   */
  ci?: boolean
}

export interface ModuleMatcher {
  filters: ModuleFilterSpec[]
}

/**
 * One labeled row in a notification spec. `label` is free text shown in
 * the email / inbox. `value` is either a bare field name on the scraped
 * document ("city") or a simple `{{field}}` composite
 * ("{{ price }} CZK {{ price_type }}"). Resolved at match time by a
 * shared grammar — see shared/notify.ts and internal/notify in Go.
 */
export interface NotificationField {
  label: string
  value: string
}

/**
 * Declarative notification spec on a module. The notification service
 * owns the surrounding HTML chrome (heading per source, unsubscribe
 * footer, row border styling); this spec only names the slots. Every
 * `value` expression supports either a bare field name or a
 * `{{field}}` substitution template. Missing / null / empty fields
 * render as empty. No filters, no loops, no nested paths.
 *
 *  - `subject`: email subject; supports `{{count}}` and any listing field.
 *  - `title`:   linked heading of each row; must resolve to something non-empty.
 *  - `url`:     href of the row title; must resolve to something non-empty.
 *  - `fields`:  optional labeled rows shown under the title. Empty values hide the row.
 */
export interface NotificationSpec {
  subject: string
  title: string
  url: string
  fields: NotificationField[]
}

/**
 * A module document as stored in MongoDB. The `code` field (the .mjs
 * bundle) is intentionally omitted from list/read API responses and
 * only served through the dedicated bundle endpoint.
 *
 * `description` is a markdown document. It is rendered in the side
 * panel of the bot configuration page and (clamped) in the module card
 * on /modules.
 *
 * `collection` is the MongoDB collection this module's bots query
 * against (e.g. `reality` for real-estate listings, `dom_changes` for
 * a DOM-diff tracker). `source` identifies which scraper publishes
 * into that collection on this module's behalf (e.g. `bazos`,
 * `sreality`). Both are snapshotted onto each bot at create time so
 * the consumer can prefilter by `(source, collection)` without a
 * module join.
 *
 * `notification` is the notification spec shown in the module preview
 * and copied onto each bot at create time. The notifier reads it off
 * the bot, not the module.
 *
 * `configSchema` is a JSON Schema the server uses to validate a user's
 * `bot.config` on save. The module author owns this schema — it's the
 * trust boundary between authored module logic (trusted) and user
 * input (untrusted). See server/utils/config-schema.ts.
 */
export interface ModuleDoc {
  id: string
  name: string
  description: string
  collection: string
  source: string
  configSchema: Record<string, unknown>
  notification: NotificationSpec
  uploaded_by: string
  created_at: string
  updated_at: string
  // `system: true` modules are seeded from the repo; their bundle and
  // identity (collection/source) are developer-owned. The UI uses this
  // to lock the `code` upload and the identity fields on the edit page.
  system: boolean
  // `editable` is a per-user convenience on the list endpoint — owner
  // OR system module for any signed-in user, matching the PATCH auth
  // rule. It's not on the single-module GET because auth is re-checked
  // server-side when the PATCH runs anyway.
  editable?: boolean
}

export interface UserDoc {
  id: string
  email: string
  name: string
  created_at: string
  bots: BotConfig[]
  unsubscribe_token: string
  preferences: UserPreferences
}

export interface UserPreferences {
  email_enabled: boolean
  weekly_digest: boolean
  important_updates: boolean
}

export interface SessionUser {
  id: string
  email: string
  name: string
}

export interface Listing {
  id: string
  source: string
  source_id: string
  title: string
  price: number | null
  price_type: string
  property_type: string
  disposition: string | null
  city: string | null
  url: string
  first_seen: string
  last_seen: string
}

/**
 * Inbox row as returned by `GET /api/notifications`. `id` is the
 * notification's ObjectId hex and is the key mark-read endpoints
 * address rows by.
 *
 * `title`, `url`, and `fields` are the resolved snapshot of the
 * module's notification spec at match time. That's what the user was
 * emailed; the inbox renders the same data even if the upstream
 * listing later changes.
 */
export interface NotificationDoc {
  id: string
  user_id: string
  bot_id: string
  listing_id: string
  source: string
  source_id: string
  run_id: string
  title: string
  url: string
  fields: NotificationField[]
  matched_at: string
  unread: boolean
}

// ---------- Dashboard / UI ----------

export type Period = 'daily' | 'weekly' | 'monthly'

export interface Range {
  start: Date
  end: Date
}

export interface Stat {
  title: string
  icon: string
  value: number | string
  variation?: number
  formatter?: (value: number) => string
}
