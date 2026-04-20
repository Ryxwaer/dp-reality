// Host contract exposed by the dp-reality app to runtime-loaded modules.

export type Ref<T = unknown> = { value: T }
export type ComputedRef<T> = { readonly value: T }
export type Reactive<T extends object> = T
export type WatchStopHandle = () => void

export type HostH = (
  type: string | Record<string, unknown>,
  propsOrChildren?: unknown,
  children?: unknown
) => unknown

export type HostRef = <T>(value: T) => Ref<T>
export type HostReactive = <T extends object>(value: T) => Reactive<T>
export type HostComputed = <T>(getter: () => T) => ComputedRef<T>
export type HostWatch = <T>(
  source: (() => T) | Ref<T>,
  cb: (value: T, oldValue: T) => void,
  options?: { immediate?: boolean, deep?: boolean }
) => WatchStopHandle
export type HostOnMounted = (cb: () => void | Promise<void>) => void

export interface ExistingBotInput {
  id: string
  name: string
  config: Record<string, unknown>
  active: boolean
}

export type FilterOp
  = | 'in'
    | 'nin'
    | 'eq'
    | 'ne'
    | 'exists'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'contains'
    | 'geo_within'

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

export interface SaveBotPayload {
  name: string
  config: Record<string, unknown>
  matcher: ModuleMatcher
  active?: boolean
}

export interface ModuleHost {
  h: HostH
  ref: HostRef
  reactive: HostReactive
  computed: HostComputed
  watch: HostWatch
  onMounted: HostOnMounted
  moduleId: string
  existingBot: ExistingBotInput | null
  saveBot: (payload: SaveBotPayload) => Promise<void>
}

export type ModuleFactory = (host: ModuleHost) => {
  setup: () => () => unknown
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

// Static descriptor the module exports alongside its factory. The host
// uses it to seed / refresh the module's row in the `modules` collection
// without knowing anything module-specific.
export interface ModuleManifest {
  name: string
  collection: string
  source: string
  description: string
  configSchema: Record<string, unknown>
  notification: NotificationSpec
}
