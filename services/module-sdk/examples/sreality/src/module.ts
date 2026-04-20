import type { ModuleFactory, ModuleMatcher, ModuleManifest } from '../../../template/host-types'

type PropertyType = '' | 'apartment' | 'house' | 'land' | 'commercial'
type ListingType = '' | 'sale' | 'rent'

interface GeoBounds {
  center: [number, number]
  radius_km: number
}

interface SrealityConfig {
  property_type: PropertyType
  listing_type: ListingType
  disposition: string
  region_text: string
  min_price: number | null
  max_price: number | null
  geo: GeoBounds | null
}

const EMPTY_CONFIG: SrealityConfig = {
  property_type: '',
  listing_type: '',
  disposition: '',
  region_text: '',
  min_price: null,
  max_price: null,
  geo: null
}

const PROPERTY_TYPE_TO_MAIN_CB: Record<Exclude<PropertyType, ''>, number> = {
  apartment: 1,
  house: 2,
  land: 3,
  commercial: 4
}
const LISTING_TYPE_TO_CB: Record<Exclude<ListingType, ''>, number> = {
  sale: 1,
  rent: 2
}

const APARTMENT_SUBCB: Record<string, number> = {
  '1+kk': 2, '1+1': 3, '2+kk': 4, '2+1': 5,
  '3+kk': 6, '3+1': 7, '4+kk': 8, '4+1': 9,
  '5+kk': 10, '5+1': 11, '6-a-vice': 12,
  atypicky: 16, pokoj: 47
}
const HOUSE_SUBCB: Record<string, number> = {
  chata: 33, rodinny: 37, vila: 39, chalupa: 43,
  'zemedelska-usedlost': 44, 'mobilni-dum': 48,
  'vicegeneracni-dum': 54
}

const APARTMENT_DISPOSITIONS = Object.keys(APARTMENT_SUBCB)
const HOUSE_DISPOSITIONS = Object.keys(HOUSE_SUBCB)

// region-id → [lon, lat], covering the biggest Czech cities.
const REGION_CENTROIDS: Record<number, [number, number]> = {
  5740: [16.6068, 49.1951],   // Brno
  3468: [14.4378, 50.0755],   // Praha
  4659: [13.3736, 49.7384],   // Plzeň
  3691: [17.3028, 49.8209],   // Olomouc
  3893: [18.2820, 49.8346],   // Ostrava
  5134: [14.4722, 50.7763],   // Liberec
  4619: [14.4209, 48.9745],   // České Budějovice
  5181: [15.8320, 50.2104],   // Hradec Králové
  5123: [15.7793, 50.0343],   // Pardubice
  4891: [15.5959, 49.3961],   // Jihlava
  4109: [17.6678, 49.2264],   // Zlín
  5098: [14.0412, 50.6607]    // Ústí nad Labem
}

const KIND_TO_PROPERTY_TYPE: Record<string, Exclude<PropertyType, ''>> = {
  byty: 'apartment',
  domy: 'house',
  pozemky: 'land',
  'komercni-nemovitosti': 'commercial'
}

const TX_TO_LISTING_TYPE: Record<string, Exclude<ListingType, ''>> = {
  prodej: 'sale',
  pronajem: 'rent'
}

const KNOWN_PARAMS = new Set([
  'cena-od', 'cena-do', 'region', 'region-id', 'region-typ', 'vzdalenost'
])

interface ParseResult {
  ok: boolean
  error?: string
  patch: Partial<SrealityConfig>
  summary: Array<{ label: string, value: string }>
  ignored: string[]
}

function parseSrealityUrl(raw: string): ParseResult {
  const out: ParseResult = { ok: false, patch: {}, summary: [], ignored: [] }

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ...out, error: 'Not a valid URL' }
  }
  if (!url.hostname.endsWith('sreality.cz')) {
    return { ...out, error: 'URL must be from sreality.cz' }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  // segments[0] should be 'hledani'
  const kind = segments[1]
  const tx = segments[2]
  const disposition = segments[3]

  const propertyType = kind ? KIND_TO_PROPERTY_TYPE[kind] : undefined
  if (propertyType) {
    out.patch.property_type = propertyType
    out.summary.push({ label: 'Type', value: propertyType })
  }

  const listingType = tx ? TX_TO_LISTING_TYPE[tx] : undefined
  if (listingType) {
    out.patch.listing_type = listingType
    out.summary.push({ label: 'Transaction', value: listingType })
  }

  if (disposition && propertyType) {
    const table = propertyType === 'house' ? HOUSE_SUBCB : APARTMENT_SUBCB
    if (disposition in table) {
      out.patch.disposition = disposition
      out.summary.push({ label: 'Disposition', value: disposition })
    }
  }

  const cenaOd = url.searchParams.get('cena-od')
  if (cenaOd) {
    const n = Number(cenaOd)
    if (Number.isFinite(n) && n > 0) {
      out.patch.min_price = n
      out.summary.push({ label: 'Min price', value: `${n.toLocaleString('cs-CZ')} CZK` })
    }
  }
  const cenaDo = url.searchParams.get('cena-do')
  if (cenaDo) {
    const n = Number(cenaDo)
    if (Number.isFinite(n) && n > 0) {
      out.patch.max_price = n
      out.summary.push({ label: 'Max price', value: `${n.toLocaleString('cs-CZ')} CZK` })
    }
  }

  const regionName = url.searchParams.get('region')?.trim()
  const regionIdRaw = url.searchParams.get('region-id')
  const vzdalenostRaw = url.searchParams.get('vzdalenost')

  const regionId = regionIdRaw ? Number(regionIdRaw) : NaN
  const vzdalenost = vzdalenostRaw ? Number(vzdalenostRaw) : NaN

  const haveCentroid = Number.isFinite(regionId) && regionId in REGION_CENTROIDS
  const haveRadius = Number.isFinite(vzdalenost) && vzdalenost > 0 && vzdalenost <= 500

  if (haveCentroid && haveRadius) {
    out.patch.geo = { center: REGION_CENTROIDS[regionId], radius_km: vzdalenost }
    out.patch.region_text = ''
    out.summary.push({
      label: 'Location',
      value: `${regionName ?? 'region'} + ${vzdalenost} km (geo)`
    })
  } else if (regionName) {
    out.patch.region_text = regionName
    out.patch.geo = null
    const note = haveRadius && !haveCentroid
      ? ` (radius ignored — region-id ${regionIdRaw} not in centroid table)`
      : ''
    out.summary.push({ label: 'Location (text)', value: regionName + note })
  }

  for (const [k] of url.searchParams) {
    if (!KNOWN_PARAMS.has(k) && out.ignored.indexOf(k) === -1) {
      out.ignored.push(k)
    }
  }

  out.ok = true
  return out
}

function compileMatcher(config: SrealityConfig): ModuleMatcher {
  const filters: ModuleMatcher['filters'] = []

  if (config.property_type) {
    filters.push({ field: 'property_type', op: 'eq', value: config.property_type })
    filters.push({ field: 'category_main_cb', op: 'eq', value: PROPERTY_TYPE_TO_MAIN_CB[config.property_type] })
  }
  if (config.listing_type) {
    filters.push({ field: 'price_type', op: 'eq', value: config.listing_type })
    filters.push({ field: 'category_type_cb', op: 'eq', value: LISTING_TYPE_TO_CB[config.listing_type] })
  }

  const disposition = (config.disposition ?? '').trim()
  if (disposition) {
    const table = config.property_type === 'house' ? HOUSE_SUBCB : APARTMENT_SUBCB
    const code = table[disposition]
    if (typeof code === 'number') {
      filters.push({ field: 'category_sub_cb', op: 'eq', value: code })
    }
  }

  if (config.geo) {
    filters.push({ field: 'gps', op: 'geo_within', value: { center: config.geo.center, radius_km: config.geo.radius_km } })
  } else {
    const region = (config.region_text ?? '').trim()
    if (region) {
      filters.push({ field: 'locality', op: 'contains', value: region, ci: true })
    }
  }

  if (typeof config.min_price === 'number' && config.min_price > 0) {
    filters.push({ field: 'price', op: 'gte', value: config.min_price })
  }
  if (typeof config.max_price === 'number' && config.max_price > 0) {
    filters.push({ field: 'price', op: 'lte', value: config.max_price })
  }

  return { filters }
}

function isValidGeo(g: unknown): g is GeoBounds {
  if (!g || typeof g !== 'object') return false
  const o = g as Record<string, unknown>
  const c = o.center
  const r = o.radius_km
  return Array.isArray(c)
    && c.length === 2
    && typeof c[0] === 'number' && Number.isFinite(c[0])
    && typeof c[1] === 'number' && Number.isFinite(c[1])
    && typeof r === 'number' && Number.isFinite(r) && r > 0 && r <= 500
}

export const manifest: ModuleManifest = {
  name: 'Sreality',
  collection: 'sreality',
  source: 'sreality',
  description: `# Sreality module

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
`,
  configSchema: {
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
  },
  notification: {
    subject: 'Sreality: {{count}} new listings',
    title: 'title',
    url: 'url',
    fields: [
      { label: 'Price', value: '{{ price }} CZK ({{ price_type }})' },
      { label: 'Location', value: '{{ locality }}' },
      { label: 'Layout', value: '{{ disposition }}' }
    ]
  }
}

function normalizeConfig(raw: Partial<SrealityConfig>): SrealityConfig {
  const cfg: SrealityConfig = { ...EMPTY_CONFIG, ...raw }
  if (!['apartment', 'house', 'land', 'commercial'].includes(cfg.property_type)) cfg.property_type = ''
  if (cfg.listing_type !== 'sale' && cfg.listing_type !== 'rent') cfg.listing_type = ''
  cfg.disposition = (cfg.disposition ?? '').toString()
  cfg.region_text = (cfg.region_text ?? '').toString()
  cfg.min_price = typeof cfg.min_price === 'number' && Number.isFinite(cfg.min_price) ? cfg.min_price : null
  cfg.max_price = typeof cfg.max_price === 'number' && Number.isFinite(cfg.max_price) ? cfg.max_price : null
  cfg.geo = isValidGeo(cfg.geo) ? cfg.geo : null
  return cfg
}

function formatGeo(g: GeoBounds): string {
  const [lon, lat] = g.center
  return `${lat.toFixed(4)}, ${lon.toFixed(4)} · ${g.radius_km} km`
}

const factory: ModuleFactory = ({ h, ref, reactive, computed, saveBot, existingBot }) => {
  const initial = normalizeConfig((existingBot?.config ?? {}) as Partial<SrealityConfig>)

  const name = ref<string>(existingBot?.name ?? 'Sreality bot')
  const active = ref<boolean>(existingBot?.active ?? true)
  const cfg = reactive<SrealityConfig>({ ...initial })

  const prefillUrl = ref<string>('')
  const prefillError = ref<string | null>(null)

  const submitting = ref<boolean>(false)
  const errorMessage = ref<string | null>(null)

  const livePreview = computed<ParseResult | null>(() => {
    const raw = (prefillUrl.value as string).trim()
    if (!raw) return null
    return parseSrealityUrl(raw)
  })

  const dispositionOptions = computed<string[]>(() => {
    if (cfg.property_type === 'house') return HOUSE_DISPOSITIONS
    if (cfg.property_type === '' || cfg.property_type === 'apartment') return APARTMENT_DISPOSITIONS
    return [] // land / commercial: no disposition axis
  })

  const compiled = computed(() => compileMatcher(cfg))
  const canSave = computed(() => compiled.value.filters.length > 0)

  function applyPrefill() {
    prefillError.value = null
    const preview = livePreview.value
    if (!preview) {
      prefillError.value = 'Paste a URL first.'
      return
    }
    if (!preview.ok) {
      prefillError.value = preview.error ?? 'Invalid URL'
      return
    }
    Object.assign(cfg, EMPTY_CONFIG, preview.patch)
  }

  function onPrefillInput(e: Event) {
    prefillUrl.value = (e.target as HTMLInputElement).value
    prefillError.value = null
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    errorMessage.value = null
    if (!canSave.value) {
      errorMessage.value = 'Pick at least one filter — type, transaction, disposition, region, or price.'
      return
    }
    submitting.value = true
    try {
      await saveBot({
        name: (name.value as string).trim() || 'Sreality bot',
        active: active.value as boolean,
        config: { ...cfg } as unknown as Record<string, unknown>,
        matcher: compiled.value
      })
    } catch (err) {
      const e = err as { data?: { message?: string }, message?: string }
      errorMessage.value = e.data?.message ?? e.message ?? 'Failed to save bot'
    } finally {
      submitting.value = false
    }
  }

  const labelCls = 'block text-sm font-medium mb-1'
  const inputCls = 'w-full rounded-md border border-default bg-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
  const hintCls = 'text-xs text-muted'
  const sectionCls = 'rounded-md border border-default bg-elevated/30 p-4 flex flex-col gap-3'

  function selectOption(value: string, label: string, current: string) {
    return h('option', { value, selected: value === current }, label)
  }

  function renderPrefillPreview() {
    if (prefillError.value) {
      return h('p', { class: 'text-sm text-error' }, prefillError.value)
    }
    const p = livePreview.value
    if (!p) {
      return h('p', { class: hintCls },
        'Optional: paste a sreality.cz/hledani URL, then click "Prefill" to fill the fields below from it.')
    }
    if (!p.ok) {
      return h('p', { class: 'text-sm text-error' }, p.error ?? 'Invalid URL')
    }
    const keys = Object.keys(p.patch)
    if (keys.length === 0) {
      return h('p', { class: 'text-sm text-warning' },
        'URL parsed but produced no fields. Try /hledani/byty or /hledani/domy with filters applied.')
    }
    return h('div', { class: 'flex flex-col gap-1' }, [
      h('p', { class: 'text-xs font-medium uppercase tracking-wide text-muted' }, 'URL will set'),
      h('ul', { class: 'flex flex-col gap-1 text-sm' },
        p.summary.map(s => h('li', { class: 'flex gap-2' }, [
          h('span', { class: 'text-muted min-w-40' }, s.label),
          h('span', { class: 'font-medium' }, s.value)
        ]))
      ),
      p.ignored.length > 0
        ? h('p', { class: 'text-xs text-muted pt-1' },
            `Ignored params: ${p.ignored.join(', ')} — not yet supported.`)
        : null
    ])
  }

  function renderGeoBadge() {
    if (!cfg.geo) return null
    return h('div', { class: 'flex items-center justify-between gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm' }, [
      h('span', {}, [
        h('span', { class: 'font-medium' }, 'Radius search (from URL): '),
        formatGeo(cfg.geo)
      ]),
      h('button', {
        type: 'button',
        class: 'text-xs text-muted hover:underline',
        onClick: () => { cfg.geo = null }
      }, 'Remove')
    ])
  }

  function renderMatcherPreview() {
    const filters = compiled.value.filters
    if (filters.length === 0) {
      return h('p', { class: 'text-sm text-warning' },
        'No filters active — the bot would match every new sreality listing. Set at least one field.')
    }
    return h('div', { class: 'flex flex-col gap-1' }, [
      h('p', { class: 'text-xs font-medium uppercase tracking-wide text-muted' }, `Matcher (${filters.length} filter${filters.length === 1 ? '' : 's'})`),
      h('ul', { class: 'flex flex-col gap-1 text-sm font-mono' },
        filters.map(f => h('li', {},
          `${f.field} ${f.op} ${JSON.stringify(f.value)}${f.ci ? '  (ci)' : ''}`
        ))
      )
    ])
  }

  return {
    setup() {
      return () => h('form', {
        class: 'flex flex-col gap-6 max-w-2xl',
        onSubmit
      }, [
        h('div', {}, [
          h('label', { class: labelCls, for: 'sreality-name' }, 'Bot name'),
          h('input', {
            id: 'sreality-name',
            class: inputCls,
            value: name.value,
            onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value }
          })
        ]),

        h('label', { class: 'inline-flex items-center gap-2 text-sm' }, [
          h('input', {
            type: 'checkbox',
            checked: active.value,
            onChange: (e: Event) => { active.value = (e.target as HTMLInputElement).checked }
          }),
          'Active'
        ]),

        h('div', { class: sectionCls }, [
          h('label', { class: labelCls, for: 'sreality-prefill' }, 'Prefill from URL (optional)'),
          h('div', { class: 'flex gap-2' }, [
            h('input', {
              id: 'sreality-prefill',
              class: inputCls,
              placeholder: 'https://www.sreality.cz/hledani/byty?region=Brno&region-id=5740&vzdalenost=10',
              value: prefillUrl.value,
              onInput: onPrefillInput
            }),
            h('button', {
              type: 'button',
              class: 'rounded-md border border-default px-3 py-2 text-sm font-medium hover:bg-elevated disabled:opacity-50',
              disabled: !livePreview.value || !livePreview.value.ok,
              onClick: applyPrefill
            }, 'Prefill')
          ]),
          renderPrefillPreview()
        ]),

        h('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-4' }, [
          h('div', {}, [
            h('label', { class: labelCls, for: 'sreality-type' }, 'Property type'),
            h('select', {
              id: 'sreality-type',
              class: inputCls,
              onChange: (e: Event) => { cfg.property_type = (e.target as HTMLSelectElement).value as PropertyType }
            }, [
              selectOption('', 'Any', cfg.property_type),
              selectOption('apartment', 'Apartments', cfg.property_type),
              selectOption('house', 'Houses', cfg.property_type),
              selectOption('land', 'Land', cfg.property_type),
              selectOption('commercial', 'Commercial', cfg.property_type)
            ])
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'sreality-listing' }, 'Transaction'),
            h('select', {
              id: 'sreality-listing',
              class: inputCls,
              onChange: (e: Event) => { cfg.listing_type = (e.target as HTMLSelectElement).value as ListingType }
            }, [
              selectOption('', 'Any', cfg.listing_type),
              selectOption('sale', 'Sale', cfg.listing_type),
              selectOption('rent', 'Rent', cfg.listing_type)
            ])
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'sreality-disp' }, 'Disposition'),
            h('select', {
              id: 'sreality-disp',
              class: inputCls,
              disabled: dispositionOptions.value.length === 0,
              onChange: (e: Event) => { cfg.disposition = (e.target as HTMLSelectElement).value }
            }, [
              selectOption('', 'Any', cfg.disposition),
              ...dispositionOptions.value.map(d => selectOption(d, d, cfg.disposition))
            ])
          ])
        ]),

        h('div', {}, [
          h('label', { class: labelCls, for: 'sreality-region' }, 'Region (text)'),
          h('input', {
            id: 'sreality-region',
            class: inputCls,
            placeholder: 'Brno, Praha, …',
            disabled: !!cfg.geo,
            value: cfg.region_text,
            onInput: (e: Event) => { cfg.region_text = (e.target as HTMLInputElement).value }
          }),
          h('p', { class: hintCls },
            cfg.geo
              ? 'Geo radius is active (from URL prefill). Remove it above to switch back to text.'
              : 'Case-insensitive substring match on each listing\'s `locality`. For radius search, prefill from a sreality URL with region-id + vzdalenost.')
        ]),

        renderGeoBadge(),

        h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' }, [
          h('div', {}, [
            h('label', { class: labelCls, for: 'sreality-min' }, 'Min price (CZK)'),
            h('input', {
              id: 'sreality-min',
              class: inputCls,
              type: 'number',
              min: 0,
              step: 10000,
              value: cfg.min_price ?? '',
              onInput: (e: Event) => {
                const v = (e.target as HTMLInputElement).value
                cfg.min_price = v === '' ? null : Number(v)
              }
            })
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'sreality-max' }, 'Max price (CZK)'),
            h('input', {
              id: 'sreality-max',
              class: inputCls,
              type: 'number',
              min: 0,
              step: 10000,
              value: cfg.max_price ?? '',
              onInput: (e: Event) => {
                const v = (e.target as HTMLInputElement).value
                cfg.max_price = v === '' ? null : Number(v)
              }
            })
          ])
        ]),

        h('div', { class: sectionCls }, [renderMatcherPreview()]),

        errorMessage.value
          ? h('p', { class: 'text-sm text-error' }, errorMessage.value)
          : null,

        h('div', { class: 'flex items-center gap-2 pt-2 border-t border-default' }, [
          h('button', {
            type: 'submit',
            class: 'rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
            disabled: submitting.value || !canSave.value
          }, submitting.value ? 'Saving…' : (existingBot ? 'Save changes' : 'Create bot'))
        ])
      ])
    }
  }
}

export default factory
