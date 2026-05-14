# analytics/01 — Global market metrics dashboard (FR-04-B)

## Goal
Satisfy FR-04-B (thesis §3.1) by surfacing global market trends —
specifically a price-evolution view across all per-source
`listings_<bot>` collections, expressed as a single MongoDB
aggregation pipeline beginning with `$unionWith`.

## Thesis references
- `03-architecture-design.tex` §3.1 Functional Requirements,
  FR-04-B:
  > "The system must display global market trends, such as the price
  > evolution of specific property types over time (e.g., \"1-room
  > flats in Brno\")."
- `03-architecture-design.tex` §3.3.5 Technology Selection — the
  aggregation-pipeline argument for MongoDB:
  > "FR-04-B (price evolution over time) is expressed as a single
  > pipeline beginning with `$unionWith` over the per-source
  > collections, followed by `$match`, `$group` by time bucket, and
  > `$avg` — no application-level aggregation required."

## Current state
- Only `HomeStats.vue` exists (FR-04-A only: active bots, paused
  bots, total matches, unread matches).
- No `$unionWith` pipeline, no market trend page.

## Scope
In: a `/market` page in the BFF, a backing API endpoint that runs
the `$unionWith` pipeline, two interactive filters
(property_type + city), a line chart of monthly average price.
Out: per-user analytics (already covered by FR-04-A).
Out: real-time / streaming aggregation. The pipeline runs on demand
per page-load with a small Nitro-level cache (5 min TTL).

## API design

`GET /api/market/price-evolution`

Query parameters (all optional):
- `property_type`: `apartment` | `house` | `land` | `commercial` |
  `other` (one). Defaults to `apartment`.
- `price_type`: `sale` | `rent`. Defaults to `sale`.
- `city_contains`: substring match against `city`. No default.
- `bucket`: `day` | `week` | `month`. Defaults to `month`.
- `window_days`: integer 30..730. Defaults to 365.

Response:
```
{
  "property_type": "apartment",
  "price_type": "sale",
  "city_filter": "Brno",
  "bucket": "month",
  "series": [
    { "ts": "2025-01-01T00:00:00.000Z", "avg_price": 4823000, "n": 132 },
    ...
  ],
  "by_source": [
    { "bot_id": "bot-sreality", "n": 1421 },
    { "bot_id": "bot-bazos",    "n":  389 },
    ...
  ]
}
```

## Pipeline

The pipeline lives in
`services/frontend/server/utils/market-pipeline.ts` and is built from
the `module_registry` so a new bot service is picked up
automatically. Read every registered `bot_id`, derive each one's
`listings_<short>` collection name from a small convention (see
"Open questions" below — needs a registry-level field), and emit:

```js
db.collection(firstCollection).aggregate([
  { $unionWith: { coll: secondCollection, pipeline: [] } },
  { $unionWith: { coll: thirdCollection, pipeline: [] } },
  { $match: {
      property_type, price_type,
      price: { $gt: 0 },
      first_seen: { $gte: windowStart },
      ...(cityContains ? { city: { $regex: cityContains, $options: 'i' } } : {})
  }},
  { $group: {
      _id: { $dateTrunc: { date: "$first_seen", unit: bucket } },
      avg_price: { $avg: "$price" },
      n: { $sum: 1 }
  }},
  { $sort: { _id: 1 } },
  { $project: { _id: 0, ts: "$_id", avg_price: 1, n: 1 } }
])
```

A parallel aggregation produces the `by_source` counts (group by
`bot_id` written into each row — see "Open questions").

## Concrete changes

### 1. Per-listings `bot_id` field
The pipeline needs `bot_id` on every listing for the `by_source`
group. The thesis §3.4.1 base schema does not explicitly list
`bot_id` — add it as an additional required base-schema field. Both
existing bots must start writing it on every upsert.

Touches:
- `services/bot-bazos/src/models.py::Listing` — add
  `bot_id: str` defaulting to `settings.service_id` at upsert time
  in the repository layer.
- `services/bot-sreality/src/listing.schema.ts` — same.
- `services/bot-bezrealitky/src/...` — already includes it (the new
  bot is written after this task).

Migration: this is data evolution per CLAUDE.md — drop / backfill the
existing collections. Backfill is trivial (`updateMany` per
collection with the literal bot_id) and is included in
`scripts/migrate-bot-id.mjs`. The script reads
`module_registry.config_collection` to discover which collections
to backfill (but really should iterate `listings_<*>` — see below).

### 2. Listings collection name in registry
Add `listings_collection` to `module_registry` so the analytics
pipeline does not have to guess.

Touches:
- `services/frontend/shared/types.ts::ModuleRegistryEntry` — add
  `listings_collection?: string` (optional so legacy rows still
  validate; analytics ignores rows where it's missing).
- Both bot services' `upsert_registry` / `upsertRegistry` — add the
  field with values `listings_bazos`, `listings_sreality`,
  `listings_bezrealitky`.
- The platform contract (thesis §3.4.5) mentions
  `config_collection` but not `listings_collection`. Note this in
  `thesis-edits/01-amendments.md` as a small extension to the
  registry shape.

### 3. Backend endpoint
`services/frontend/server/api/market/price-evolution.get.ts` —
auth-required (use `requireUserIdHex`), reads the registry, builds
the pipeline as above, returns the JSON shape above.

Cache layer: wrap with Nitro `defineCachedEventHandler` keyed by the
query parameters with `maxAge: 300`.

### 4. Frontend page
`services/frontend/app/pages/market.vue`:
- Filter row at top: property_type select, price_type select,
  city_contains input, bucket select.
- Main panel: a line chart of `series[*].avg_price` over `series[*].ts`.
- Side panel: a small table of `by_source` counts.

Charting library: use whatever Nuxt UI ships with chart components if
available; otherwise `vue-chartjs` + `chart.js`. Add the dep to
`package.json`. Avoid heavy chart libs (no `echarts` / `d3` for one
chart). Configure to render a smooth line, no fill, with a single
neutral colour matching the existing palette.

Add `/market` to the sidebar navigation in
`services/frontend/app/layouts/default.vue` (between Bots and
Settings) and gate it behind the standard auth middleware.

### 5. Index support
The `$match` stage filters on `(property_type, price_type, first_seen,
city)`. Each `listings_<bot>` collection already indexes `price` and
`first_seen` individually. Add a compound index on
`(property_type, price_type, first_seen)` to each listings
collection (declared in each bot's repository `ensure_indexes`).
Without it the pipeline scans every collection — fine for a few
thousand documents, painful at any scale.

## Acceptance criteria
- `GET /api/market/price-evolution` returns valid JSON in the
  documented shape for the default filters.
- The pipeline genuinely uses `$unionWith` (verifiable via
  `db.command({explain: {aggregate: ...}})`).
- Adding a new bot service whose `module_registry` row carries
  `listings_collection` causes its data to appear in the next
  request without a code change.
- The `/market` page renders the chart and table; changing filters
  re-fetches.
- Visiting `/market` while another user is logged in shows the same
  global data (it is intentionally not user-scoped).

## Open questions
- **Registry field name.** `listings_collection` vs.
  `listings_collection_name`. Pick `listings_collection` for
  symmetry with `config_collection`.
- **What to do for bot services without a listings collection?**
  The thesis (§3.3.4) explicitly allows a bot to have none ("a
  stateless bot may have none"). The pipeline must skip those —
  filter the registry to rows where `listings_collection` is
  populated.
