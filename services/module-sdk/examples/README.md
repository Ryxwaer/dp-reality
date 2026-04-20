# Example modules

Two ready-to-upload modules — one per scraper currently shipping in
`services/jobs/` — together with their TypeScript sources.

| Source   | Upload this file           | TS source                | Target collection |
|----------|----------------------------|--------------------------|-------------------|
| Sreality | `sreality/dist/module.mjs` | `sreality/src/module.ts` | `sreality`        |
| Bazos    | `bazos/dist/module.mjs`    | `bazos/src/module.ts`    | `bazos`           |

Each example is a real bundled module: TypeScript in `src/`, bundled with
the shared `build.mjs` into `dist/module.mjs`. That bundle is what you
upload via **Modules → Upload module**; nothing in `src/` or
`node_modules/` is shipped to the browser.

## Structured config, URL as prefill

Both built-ins expose **structured** configuration — every filter axis
(listing type, category, search text, postal code, region, price, …)
is its own form field. Users can fill the form by hand, or paste a
portal search URL and hit **Prefill from URL**: the module parses the
URL and replaces every field with values extracted from it (one-shot
convert). The URL itself is **not** persisted on the bot — only the
resulting structured config. That means re-editing a bot shows the
actual fields, not a URL the portal may have rewritten.

At save time the module's `compileMatcher(config)` turns the
structured config into concrete filters.

### Bazos (`reality.bazos.cz`)

Structured config:

| Field         | Emitted filter(s)                                    |
|---------------|------------------------------------------------------|
| `listing_type` (`sale`/`rent`) | `price_type eq …` + `category_main eq …` |
| `property_sub` (`byt`/`dum`/…) | `category_sub eq …`                      |
| `search_text` | `description contains …` (case-insensitive)          |
| `psc` (5-digit) | `psc eq …`                                         |
| `min_price` / `max_price` | `price gte …` / `price lte …`            |

URL prefill (`/<prodam|pronajem>/<byt|dum|…>/?hledat=…&hlokalita=…&cenaod=…&cenado=…`)
populates those fields. `humkreis` (radius) is always ignored — bazos
has no coordinates on listings.

### Sreality (`sreality.cz`)

Structured config:

| Field           | Emitted filter(s)                                          |
|-----------------|------------------------------------------------------------|
| `property_type` (`apartment`/`house`/`land`/`commercial`) | `property_type eq …` + `category_main_cb eq …` |
| `listing_type`  | `price_type eq …` + `category_type_cb eq …`                |
| `disposition`   | `category_sub_cb eq …` (via lookup table, per property type) |
| `region_text`   | `locality contains …` (used only when `geo` is null)       |
| `geo` (URL-only) `{ center:[lon,lat], radius_km }` | `gps geo_within …` — wins over `region_text` |
| `min_price` / `max_price` | `price gte …` / `price lte …`                    |

URL prefill (`/hledani/<byty|domy>/<prodej|pronajem>[/<disposition>]?cena-od=…&cena-do=…&region=…&region-id=…&vzdalenost=…`)
can additionally set `geo` when `region-id` is in the centroid table
(~12 biggest Czech cities) and `vzdalenost` is in range. Manual entry
is always text-only — if a user wants a radius search they need to
prefill from a URL (or remove the geo badge on edit to switch back to
text).

## New matcher ops used here

Both bundles lean on two recent additions to `FILTER_OPS`:

- **`contains`** — case-insensitive substring. Compiles to
  `{ $regex: <literal-escaped>, $options: 'i' }`. Used by bazos for
  `hledat` and by sreality for `region` text fallback.
- **`geo_within`** — expects `{ center: [lon, lat], radius_km }` and
  requires the target field to be a GeoJSON Point with a `2dsphere`
  index. Compiles to `$geoWithin: { $centerSphere: [[lon, lat],
  radius_km / 6378.1] }`. The sreality scraper creates the index.

See [`../README.md`](../README.md) for the full operator table.

## What they do at save time

1. Read the structured fields off the reactive `cfg` object.
2. Build `matcher = compileMatcher(cfg)` directly from those fields —
   the URL is never touched on save; it only participates when the
   user explicitly clicks **Prefill** (which mutates `cfg` in place).
3. Call `host.saveBot({ name, config: { ...cfg }, matcher })`.

The server validates `config` against the module's structured JSON
Schema (enums for `listing_type` / `property_type`, a `^\d{5}$`
pattern for `psc`, a bounded `geo.radius_km`, and so on), and the
`matcher` against the operator / field-path whitelist. It then
snapshots `{ source, collection, matcher, notification }` onto
`users.bots[]`. The Go notifier later compiles that snapshotted
matcher into a native Mongo query on every scrape run — no module-side
code runs on the hot path.

## Rebuilding from source

```bash
cd sreality   # or bazos
npm install
npm run build
```

This regenerates `dist/module.mjs` using the shared `build.mjs` from
`services/module-sdk/template/`. When you update a built-in, also
regenerate the copy the frontend ships:

```bash
# From the repo root:
cp services/module-sdk/examples/sreality/dist/module.mjs \
   services/frontend/server/assets/seed-modules/sreality.mjs
cp services/module-sdk/examples/bazos/dist/module.mjs \
   services/frontend/server/assets/seed-modules/bazos.mjs

cd services/frontend && node scripts/sync-seed-bundles.mjs
```

The next `GET /api/modules` after that will upsert the refreshed
bundles through `ensureSeededModules()`.
