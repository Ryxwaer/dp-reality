import { ObjectId } from 'mongodb'
import { getDb, COLLECTIONS } from './db'
import { SREALITY_BUNDLE, BAZOS_BUNDLE } from '../seeds/generated-bundles'
import type { NotificationSpec } from '~~/shared/types'

/**
 * Ensures the two built-in modules (Sreality, Bazos) exist in the `modules`
 * collection. Idempotent and safe to call many times.
 *
 * Each built-in targets its own collection (`bazos` / `sreality`) and
 * owns a native schema — there is no shared "reality" collection anymore,
 * so the two seeds can publish different config schemas + different
 * notification shapes without fighting over a lowest-common-denominator.
 *
 * Config is **structured** per module — each filter axis (price, region,
 * disposition, …) is its own field. The bundled `.mjs` also accepts a
 * sreality.cz/bazos.cz search URL as a *convenience prefill*: pasting a
 * URL and clicking "Prefill" replaces every field from the URL's
 * parameters (one-shot convert). The URL itself is **not** persisted.
 * At save time the module's `compileMatcher(config)` turns the
 * structured config into a matcher (`contains` on description for
 * bazos text search, `geo_within` on `gps` for sreality's `vzdalenost`).
 */

const SYSTEM_USER_ID = new ObjectId('000000000000000000000000')

interface SeedSpec {
  id: ObjectId
  name: string
  collection: string
  source: string
  description: string
  configSchema: Record<string, unknown>
  notification: NotificationSpec
  code: string
}

/**
 * Structured configSchema for the Bazos module. Every filter axis the
 * UI exposes is represented here — the pasted URL is only a convenience
 * prefill inside the `.mjs` and is never stored on the bot.
 */
const BAZOS_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    listing_type: { type: 'string', enum: ['', 'sale', 'rent'] },
    property_sub: {
      type: 'string',
      enum: [
        '', 'byt', 'dum', 'pozemek',
        'nebytove-prostory', 'kancelar', 'sklad', 'obchod',
        'garaz', 'chata', 'chalupa', 'ostatni'
      ]
    },
    search_text: { type: 'string', maxLength: 200 },
    psc: { type: 'string', pattern: '^(\\d{5})?$' },
    min_price: { type: ['number', 'null'], minimum: 0 },
    max_price: { type: ['number', 'null'], minimum: 0 }
  }
}

/**
 * Structured configSchema for the Sreality module. `geo` is optional
 * and only gets populated when the user prefills from a URL that
 * includes a resolvable `region-id` + `vzdalenost`. Manual input only
 * ever touches `region_text`.
 */
const SREALITY_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    property_type: { type: 'string', enum: ['', 'apartment', 'house', 'land', 'commercial'] },
    listing_type: { type: 'string', enum: ['', 'sale', 'rent'] },
    disposition: { type: 'string', maxLength: 16 },
    region_text: { type: 'string', maxLength: 128 },
    min_price: { type: ['number', 'null'], minimum: 0 },
    max_price: { type: ['number', 'null'], minimum: 0 },
    geo: {
      oneOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['center', 'radius_km'],
          properties: {
            center: {
              type: 'array',
              minItems: 2,
              maxItems: 2,
              items: { type: 'number' }
            },
            radius_km: { type: 'number', minimum: 0, maximum: 500 }
          }
        }
      ]
    }
  }
}

const BAZOS_NOTIFICATION: NotificationSpec = {
  subject: 'Bazos: {{count}} new listings',
  title: 'title',
  url: 'url',
  fields: [
    { label: 'Price', value: '{{ price }} CZK ({{ price_type }})' },
    { label: 'Location', value: '{{ city }} {{ psc }}' },
    { label: 'Description', value: '{{ description }}' }
  ]
}

const SREALITY_NOTIFICATION: NotificationSpec = {
  subject: 'Sreality: {{count}} new listings',
  title: 'title',
  url: 'url',
  fields: [
    { label: 'Price', value: '{{ price }} CZK ({{ price_type }})' },
    { label: 'Location', value: '{{ locality }}' },
    { label: 'Layout', value: '{{ disposition }}' }
  ]
}

const SREALITY_DESCRIPTION = `# Sreality module

Configure a search over **sreality.cz** — the bot will email you
whenever a new listing matches the filters you pick.

## How it works

Every filter axis is its own form field (type, transaction, disposition,
region, price). You can also paste a sreality.cz/hledani URL and click
**Prefill from URL** — the module parses the URL and replaces every
field from it (one-shot convert). The URL itself is not saved.

URL parsing covers:

| Source                                | Populates                                 |
|---------------------------------------|-------------------------------------------|
| \`/hledani/<byty|domy|pozemky|…>\`   | property type                             |
| \`/<prodej|pronajem>\`                | transaction                               |
| \`/<disposition>\` path segment       | disposition (e.g. \`1+kk\`)                |
| \`cena-od\` / \`cena-do\`             | min / max price                           |
| \`region\`                            | free-text region (locality contains)      |
| \`region-id\` + \`vzdalenost\`        | true radius search via GeoJSON \`gps\`     |

Radius search only compiles to \`$geoWithin\` when the URL includes a
\`region-id\` the module has a centroid for (~12 biggest Czech cities).
Manual text input always produces a \`locality contains\` match.

## Data shape

Each match in the \`sreality\` collection stores:
- \`title\`, \`price\`, \`price_type\`, \`disposition\`
- \`locality\`, \`city\`
- \`gps\` (GeoJSON Point, \`[lon, lat]\`)
- \`category_main_cb\`, \`category_sub_cb\`, \`category_type_cb\`
- \`labels\` — structural tags (ownership, material, state)
- \`url\`
`

const BAZOS_DESCRIPTION = `# Bazos module

Configure a search over **reality.bazos.cz** — the bot will email you
whenever a new listing matches the filters you pick.

## How it works

Every filter axis is its own form field (listing type, category,
search text, postal code, price). You can also paste a bazos.cz URL
and click **Prefill from URL** — the module parses the URL and
replaces every field from it (one-shot convert). The URL itself is
not saved.

URL parsing covers:

| Source                    | Populates                                        |
|---------------------------|--------------------------------------------------|
| \`/<prodam|pronajem>/\`   | listing type                                     |
| \`/<byt|dum|…>/\`         | category                                         |
| \`hledat\`                | search text (description contains)               |
| \`hlokalita\`             | postal code (exact match)                        |
| \`cenaod\` / \`cenado\`   | min / max price                                  |
| \`humkreis\`              | **ignored** — bazos has no coordinates on listings |

## Data shape

Each match in the \`bazos\` collection stores:
- \`title\`, \`description\` (teaser from the list page), \`price\`, \`price_type\`
- \`psc\`, \`city\`, \`locality_raw\`
- \`category_main\`, \`category_sub\`, \`property_type\`
- \`url\`

No disposition field — Bazos list pages don't expose a structured
disposition column. Filter on \`title\` contains instead if you want
\`2+kk\` matches.
`

const SEEDS: SeedSpec[] = [
  {
    id: new ObjectId('000000000000000000000001'),
    name: 'Sreality',
    collection: 'sreality',
    source: 'sreality',
    description: SREALITY_DESCRIPTION,
    configSchema: SREALITY_CONFIG_SCHEMA,
    notification: SREALITY_NOTIFICATION,
    code: SREALITY_BUNDLE
  },
  {
    id: new ObjectId('000000000000000000000002'),
    name: 'Bazos',
    collection: 'bazos',
    source: 'bazos',
    description: BAZOS_DESCRIPTION,
    configSchema: BAZOS_CONFIG_SCHEMA,
    notification: BAZOS_NOTIFICATION,
    code: BAZOS_BUNDLE
  }
]

let ensurePromise: Promise<void> | null = null

async function doSeed(): Promise<void> {
  const db = await getDb()
  let inserted = 0
  let updated = 0

  for (const seed of SEEDS) {
    if (!seed.code || !seed.code.length) {
      console.warn(`[seed-modules] skipping ${seed.name} — empty bundle`)
      continue
    }
    const now = new Date()
    // Fields are split across `$set` and `$setOnInsert` so we never
    // stomp on UI edits. The .mjs bundle and its identity (`name`,
    // `collection`, `source`) are developer-owned — they come from
    // the repo and must always reflect the latest build. Everything
    // else (`description`, `configSchema`, `notification`) is
    // user-editable at runtime via PATCH /api/modules/:id, so we
    // only seed those on initial insert.
    const res = await db.collection(COLLECTIONS.modules).updateOne(
      { _id: seed.id },
      {
        $set: {
          name: seed.name,
          collection: seed.collection,
          source: seed.source,
          code: seed.code,
          system: true,
          system_author: 'dp-reality'
        },
        $unset: {
          documentation: '',
          notification_template: '',
          matcher: ''
        },
        $setOnInsert: {
          description: seed.description,
          configSchema: seed.configSchema,
          notification: seed.notification,
          uploaded_by: SYSTEM_USER_ID,
          created_at: now,
          updated_at: now
        }
      },
      { upsert: true }
    )
    if (res.upsertedCount) inserted++
    else if (res.modifiedCount) updated++
  }

  console.log(`[seed-modules] ensured built-ins: ${inserted} inserted, ${updated} refreshed`)
}

/**
 * Run the seeder at most once per process. Idempotent — cached promise is
 * returned on subsequent calls so concurrent requests don't hammer the DB.
 * If the seed fails the error is re-thrown and the cache is cleared so the
 * next caller can retry.
 */
export function ensureSeededModules(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = doSeed().catch((err) => {
      ensurePromise = null
      throw err
    })
  }
  return ensurePromise
}
