/**
 * Host contract exposed by the dp-reality app to runtime-loaded modules.
 * This is a standalone copy intended for use inside module bundles — Vue is
 * NEVER imported by a module; every primitive a module needs arrives on the
 * host object that the factory is called with.
 */

// Minimal ambient surface of the Vue primitives exposed on the host. We do
// not depend on Vue's real types here so authors don't need `vue` installed
// locally just to compile their module.

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

/**
 * Operators a module matcher may use. Mirrors FILTER_OPS in
 * services/frontend/shared/types.ts. Deliberately excludes `$where`,
 * `$expr`, and anything that could evaluate code — the Go notifier
 * refuses anything not in this list.
 *
 *   - `contains` is a bounded case-insensitive substring match. The
 *     host escapes the value as a literal before emitting `$regex`,
 *     so authors cannot ship arbitrary regex.
 *   - `geo_within` takes `{ center: [lon, lat], radius_km }` and
 *     requires the target field to be a GeoJSON Point with a
 *     `2dsphere` index (e.g. sreality's `gps`).
 */
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

/**
 * Payload for a `geo_within` filter. GeoJSON-order `[lon, lat]`; the
 * notifier compiles this to `$geoWithin: { $centerSphere: [[lon, lat],
 * radius_km / 6378.1] }`.
 */
export interface GeoWithinValue {
  center: [number, number]
  radius_km: number
}

/**
 * One predicate a module's .mjs produces at save time. `value` is a
 * concrete literal — the module has already resolved user config into
 * real numbers/strings. `field` is a dotted path on the target
 * collection's document (e.g. `city`, `price`, `gps`).
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
  /** Case-insensitive compare. Only valid for in/nin/eq/ne/contains. */
  ci?: boolean
}

export interface ModuleMatcher {
  filters: ModuleFilterSpec[]
}

/**
 * Payload handed back to the host when the user clicks save. The
 * module author is responsible for composing `matcher` from their
 * own `config` state — the server validates shape (op whitelist,
 * field pattern, value types) but never semantics.
 *
 * It is conventional for modules to drop empty-array `in`/`nin`
 * filters client-side (absent config ⇒ no filter on that axis).
 */
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

/**
 * A runtime module is an ES module whose default export is a factory that
 * receives the host and returns a Vue component. The app resolves `setup()`
 * against the real Vue instance when the component is mounted.
 */
export type ModuleFactory = (host: ModuleHost) => {
  setup: () => () => unknown
}
