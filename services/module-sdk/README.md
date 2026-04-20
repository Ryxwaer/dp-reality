# dp-reality module SDK

A minimal scaffold for authoring **runtime-loaded modules** for the `dp-reality`
frontend. A module is a single ES module (`.mjs`) that is uploaded to the app
through `/modules/upload`, stored in MongoDB, and dynamically imported in the
browser whenever a user creates or edits a bot based on it.

## What a module is

A module's default export is a **factory function** that receives a host object
and returns a Vue component. The host hands in the Vue primitives the module
needs (`h`, `ref`, `reactive`, `computed`, `watch`, `onMounted`), plus an
opinionated helper `saveBot(payload)` that persists the bot to the current
user's `users.bots[]`.

```ts
import type { ModuleFactory } from './host-types'

const factory: ModuleFactory = ({ h, ref, saveBot, existingBot }) => ({
  setup() {
    // … build your reactive state and return a render function …
  }
})

export default factory
```

The module **must not** import Vue — Vue is provided on the host. This keeps a
single Vue instance in the page, which is required for the loaded component to
render correctly.

## Contract

```ts
interface ExistingBotInput {
  id: string
  name: string
  config: Record<string, unknown>
  active: boolean
}

interface GeoWithinValue {
  center: [number, number] // [lon, lat] — GeoJSON order
  radius_km: number
}

interface ModuleFilterSpec {
  field: string        // dotted path on the target collection's document
  op:
    | 'in' | 'nin' | 'eq' | 'ne' | 'exists'
    | 'gt' | 'gte' | 'lt' | 'lte'
    | 'contains'       // case-insensitive substring (literal-escaped regex)
    | 'geo_within'     // point in radius; field must be a GeoJSON Point + 2dsphere
  value?:
    | string | number | boolean
    | Array<string | number | boolean>
    | GeoWithinValue
  ci?: boolean         // case-insensitive; only valid for in/nin/eq/ne/contains
}
interface ModuleMatcher { filters: ModuleFilterSpec[] }

interface SaveBotPayload {
  name: string
  config: Record<string, unknown>
  matcher: ModuleMatcher
  active?: boolean
}

interface ModuleHost {
  h: typeof import('vue').h
  ref: typeof import('vue').ref
  reactive: typeof import('vue').reactive
  computed: typeof import('vue').computed
  watch: typeof import('vue').watch
  onMounted: typeof import('vue').onMounted
  moduleId: string
  existingBot: ExistingBotInput | null
  saveBot: (payload: SaveBotPayload) => Promise<void>
}

type ModuleFactory = (host: ModuleHost) => import('vue').Component
```

Call `saveBot(payload)` to persist a bot — the app handles both create and edit
based on whether the page was opened in `new` or `edit` mode.

### Matcher responsibility

The module is the **sole author of its matcher**. When the user clicks save,
your factory translates its own `config` state into a concrete
`ModuleMatcher` (values inlined — no `config.*` indirection) and hands it to
`saveBot` alongside the raw `config`. The server validates the matcher
shape (operator whitelist, field-path pattern, value types), snapshots
`{ source, collection, matcher, notification }` onto the bot, and the Go
notifier later compiles the matcher into a native Mongo query on every
scrape run. At run time there is no module join — the bot carries
everything the notifier needs.

Conventions:

- Drop `in` / `nin` filters whose value array would be empty. An absent
  config axis should mean *no filter on that axis*, not *match nothing*.
- Never route user-entered free text into the `field` slot. Use only
  field paths you control.
- `contains` is the only text-search primitive. The host compiler
  literal-escapes the value before emitting a regex, so authors cannot
  ship arbitrary regex — which keeps ReDoS and `$where`-alike foot-guns
  off the table.
- `geo_within` requires the target collection to carry a GeoJSON `Point`
  under the specified field *and* a `2dsphere` index on it. The scraper
  that owns the collection is responsible for both. See
  `examples/sreality/` for a working pattern.

### Config validation

Each module also declares a JSON Schema in its `configSchema` field (see
the **Modules → Upload module** page). The server validates every
`saveBot` payload's `config` against that schema before persisting, so
your factory can assume any `config` it reads back from `existingBot`
has already been vetted.

## Getting started

```bash
cd template
npm install
npm run build
```

This produces `dist/module.mjs`. Upload that file from the app via
**Modules → Upload module**.

## Trust model (POC)

In this POC any authenticated user can upload any JavaScript, and that code
runs in every other user's browser when they open the module. Only upload
modules you have reviewed.

Future work (tracked in the thesis): admin-only upload, signed bundles, iframe
sandbox with `postMessage` host API, optional server-side hooks under a real
VM (e.g. `isolated-vm`).
