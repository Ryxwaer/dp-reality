export type PriceType = 'sale' | 'rent' | 'auction' | 'unknown'

export type PropertyType
  = | 'apartment'
    | 'house'
    | 'land'
    | 'commercial'
    | 'other'

export const BOT_STATUSES = ['active', 'stopped', 'deleted'] as const
export type BotStatus = typeof BOT_STATUSES[number]

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

export interface GeoWithinValue {
  center: [number, number]
  radius_km: number
}

export interface ModuleFilterSpec {
  field: string
  op: FilterOp
  value?:
    | string
    | number
    | boolean
    | Array<string | number | boolean>
    | GeoWithinValue
  ci?: boolean
}

export interface ModuleMatcher {
  filters: ModuleFilterSpec[]
}

export interface NotificationField {
  label: string
  value: string
}

export interface NotificationSpec {
  subject: string
  title: string
  url: string
  fields: NotificationField[]
}

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
  system: boolean
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
