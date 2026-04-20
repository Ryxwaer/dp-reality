import type { ModuleFactory, ModuleMatcher } from '../../../template/host-types'

/**
 * Bazos module. Configuration is **structured** — each filter is its
 * own field in `config`. Users can fill the form by hand, or paste a
 * reality.bazos.cz URL and click "Prefill from URL" to replace every
 * field with values extracted from that URL (one-shot convert).
 *
 * `compileMatcher` then reads the structured config and emits filters
 * over the `bazos` collection. The URL itself is **not** persisted —
 * only the resulting fields. This makes re-editing a bot obvious
 * (you see the fields, not a URL the portal may have rewritten).
 *
 * Supported structured fields → matcher output:
 *
 *   listing_type  (sale|rent)   → price_type eq, category_main eq
 *   property_sub  (byt|dum|…)   → category_sub eq
 *   search_text                 → description contains (ci)
 *   psc           (5 digits)    → psc eq
 *   min_price / max_price       → price gte / price lte
 *
 * `humkreis` (radius) is intentionally unsupported — bazos has no
 * coordinates on listings, so a radius would be a lie on our side.
 */

type ListingType = '' | 'sale' | 'rent'
type PropertySub
  = | ''
    | 'byt' | 'dum' | 'pozemek'
    | 'nebytove-prostory' | 'kancelar' | 'sklad' | 'obchod'
    | 'garaz' | 'chata' | 'chalupa' | 'ostatni'

interface BazosConfig {
  listing_type: ListingType
  property_sub: PropertySub
  search_text: string
  psc: string
  min_price: number | null
  max_price: number | null
}

const EMPTY_CONFIG: BazosConfig = {
  listing_type: '',
  property_sub: '',
  search_text: '',
  psc: '',
  min_price: null,
  max_price: null
}

// Bazos stores `category_main` as the URL path slug it scraped from
// (`prodam` for sale, `pronajmu` for rent — the latter is the verb
// form Bazos actually uses; `pronajem` returns a soft-404). Keep this
// in sync with `_CATEGORY_MAIN_TO_PRICE` on the scraper.
const LISTING_TYPE_TO_MAIN: Record<Exclude<ListingType, ''>, string> = {
  sale: 'prodam',
  rent: 'pronajmu'
}

// URL-prefill is tolerant on both historical variants — users may
// paste either a Bazos-generated URL (`pronajmu`) or the dictionary
// form (`pronajem`) picked up elsewhere.
const BAZOS_PATH_PRICE: Record<string, Exclude<ListingType, ''>> = {
  prodam: 'sale',
  pronajmu: 'rent',
  pronajem: 'rent'
}

const PROPERTY_SUBS: PropertySub[] = [
  '',
  'byt', 'dum', 'pozemek',
  'nebytove-prostory', 'kancelar', 'sklad', 'obchod',
  'garaz', 'chata', 'chalupa', 'ostatni'
]
const BAZOS_PATH_SUBCAT = new Set<string>(PROPERTY_SUBS.filter(Boolean))

const KNOWN_PARAMS = new Set(['hledat', 'hlokalita', 'cenaod', 'cenado'])

interface ParseResult {
  ok: boolean
  error?: string
  patch: Partial<BazosConfig>
  summary: Array<{ label: string, value: string }>
  ignored: string[]
}

function parseBazosUrl(raw: string): ParseResult {
  const out: ParseResult = { ok: false, patch: {}, summary: [], ignored: [] }

  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ...out, error: 'Not a valid URL' }
  }
  if (!url.hostname.endsWith('bazos.cz')) {
    return { ...out, error: 'URL must be from bazos.cz' }
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const main = segments[0]
  const sub = segments[1]

  const priceType = main ? BAZOS_PATH_PRICE[main] : undefined
  if (priceType) {
    out.patch.listing_type = priceType
    out.summary.push({ label: 'Listing type', value: priceType })
  }
  if (sub && BAZOS_PATH_SUBCAT.has(sub)) {
    out.patch.property_sub = sub as PropertySub
    out.summary.push({ label: 'Subcategory', value: sub })
  }

  const hledat = url.searchParams.get('hledat')
  if (hledat && hledat.trim()) {
    out.patch.search_text = hledat.trim()
    out.summary.push({ label: 'Search text (in description)', value: hledat.trim() })
  }

  const psc = url.searchParams.get('hlokalita')
  if (psc && /^\d{5}$/.test(psc)) {
    out.patch.psc = psc
    out.summary.push({ label: 'Postal code', value: psc })
  }

  const cenaod = url.searchParams.get('cenaod')
  if (cenaod) {
    const n = Number(cenaod)
    if (Number.isFinite(n) && n > 0) {
      out.patch.min_price = n
      out.summary.push({ label: 'Min price', value: `${n.toLocaleString('cs-CZ')} CZK` })
    }
  }
  const cenado = url.searchParams.get('cenado')
  if (cenado) {
    const n = Number(cenado)
    if (Number.isFinite(n) && n > 0) {
      out.patch.max_price = n
      out.summary.push({ label: 'Max price', value: `${n.toLocaleString('cs-CZ')} CZK` })
    }
  }

  for (const [k] of url.searchParams) {
    if (!KNOWN_PARAMS.has(k) && out.ignored.indexOf(k) === -1) {
      out.ignored.push(k)
    }
  }

  out.ok = true
  return out
}

function compileMatcher(config: BazosConfig): ModuleMatcher {
  const filters: ModuleMatcher['filters'] = []

  if (config.listing_type) {
    filters.push({ field: 'price_type', op: 'eq', value: config.listing_type })
    filters.push({ field: 'category_main', op: 'eq', value: LISTING_TYPE_TO_MAIN[config.listing_type] })
  }
  if (config.property_sub) {
    filters.push({ field: 'category_sub', op: 'eq', value: config.property_sub })
  }
  const text = (config.search_text ?? '').trim()
  if (text) {
    filters.push({ field: 'description', op: 'contains', value: text, ci: true })
  }
  const psc = (config.psc ?? '').trim()
  if (/^\d{5}$/.test(psc)) {
    filters.push({ field: 'psc', op: 'eq', value: psc })
  }
  if (typeof config.min_price === 'number' && config.min_price > 0) {
    filters.push({ field: 'price', op: 'gte', value: config.min_price })
  }
  if (typeof config.max_price === 'number' && config.max_price > 0) {
    filters.push({ field: 'price', op: 'lte', value: config.max_price })
  }

  return { filters }
}

function normalizeConfig(raw: Partial<BazosConfig>): BazosConfig {
  const cfg: BazosConfig = { ...EMPTY_CONFIG, ...raw }
  if (!PROPERTY_SUBS.includes(cfg.property_sub as PropertySub)) cfg.property_sub = ''
  if (cfg.listing_type !== 'sale' && cfg.listing_type !== 'rent') cfg.listing_type = ''
  cfg.search_text = (cfg.search_text ?? '').toString()
  cfg.psc = (cfg.psc ?? '').toString()
  cfg.min_price = typeof cfg.min_price === 'number' && Number.isFinite(cfg.min_price) ? cfg.min_price : null
  cfg.max_price = typeof cfg.max_price === 'number' && Number.isFinite(cfg.max_price) ? cfg.max_price : null
  return cfg
}

const factory: ModuleFactory = ({ h, ref, reactive, computed, saveBot, existingBot }) => {
  const initial = normalizeConfig((existingBot?.config ?? {}) as Partial<BazosConfig>)

  const name = ref<string>(existingBot?.name ?? 'Bazos bot')
  const active = ref<boolean>(existingBot?.active ?? true)
  const cfg = reactive<BazosConfig>({ ...initial })

  const prefillUrl = ref<string>('')
  const prefillError = ref<string | null>(null)
  const lastPrefill = ref<{ summary: ParseResult['summary'], ignored: string[] } | null>(null)

  const submitting = ref<boolean>(false)
  const errorMessage = ref<string | null>(null)

  const livePreview = computed<ParseResult | null>(() => {
    const raw = (prefillUrl.value as string).trim()
    if (!raw) return null
    return parseBazosUrl(raw)
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
    // Replace-all: wipe every field, then apply whatever the URL gave us.
    Object.assign(cfg, EMPTY_CONFIG, preview.patch)
    lastPrefill.value = { summary: preview.summary, ignored: preview.ignored }
  }

  function onPrefillInput(e: Event) {
    prefillUrl.value = (e.target as HTMLInputElement).value
    prefillError.value = null
  }

  async function onSubmit(e: Event) {
    e.preventDefault()
    errorMessage.value = null
    if (!canSave.value) {
      errorMessage.value = 'Pick at least one filter — listing type, price, postal code, or search text.'
      return
    }
    submitting.value = true
    try {
      await saveBot({
        name: (name.value as string).trim() || 'Bazos bot',
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
        'Optional: paste a reality.bazos.cz search URL, then click "Prefill" to fill the fields below from it.')
    }
    if (!p.ok) {
      return h('p', { class: 'text-sm text-error' }, p.error ?? 'Invalid URL')
    }
    const keys = Object.keys(p.patch)
    if (keys.length === 0) {
      return h('p', { class: 'text-sm text-warning' },
        'URL parsed but produced no fields. Add e.g. a price range, postal code, or search text on bazos.')
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
            `Ignored params: ${p.ignored.join(', ')} — humkreis (radius) is not supported on bazos.`)
        : null
    ])
  }

  function renderMatcherPreview() {
    const filters = compiled.value.filters
    if (filters.length === 0) {
      return h('p', { class: 'text-sm text-warning' },
        'No filters active — the bot would match every new bazos listing. Set at least one field.')
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
          h('label', { class: labelCls, for: 'bazos-name' }, 'Bot name'),
          h('input', {
            id: 'bazos-name',
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
          h('label', { class: labelCls, for: 'bazos-prefill' }, 'Prefill from URL (optional)'),
          h('div', { class: 'flex gap-2' }, [
            h('input', {
              id: 'bazos-prefill',
              class: inputCls,
              placeholder: 'https://reality.bazos.cz/prodam/byt/?hledat=1%2Bkk&hlokalita=60200&cenado=5000000',
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

        h('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' }, [
          h('div', {}, [
            h('label', { class: labelCls, for: 'bazos-listing' }, 'Listing type'),
            h('select', {
              id: 'bazos-listing',
              class: inputCls,
              onChange: (e: Event) => { cfg.listing_type = (e.target as HTMLSelectElement).value as ListingType }
            }, [
              selectOption('', 'Any', cfg.listing_type),
              selectOption('sale', 'Sale', cfg.listing_type),
              selectOption('rent', 'Rent', cfg.listing_type)
            ])
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'bazos-sub' }, 'Category'),
            h('select', {
              id: 'bazos-sub',
              class: inputCls,
              onChange: (e: Event) => { cfg.property_sub = (e.target as HTMLSelectElement).value as PropertySub }
            }, [
              selectOption('', 'Any', cfg.property_sub),
              ...PROPERTY_SUBS.filter(Boolean).map(s => selectOption(s, s, cfg.property_sub))
            ])
          ])
        ]),

        h('div', {}, [
          h('label', { class: labelCls, for: 'bazos-text' }, 'Search text (matched in description)'),
          h('input', {
            id: 'bazos-text',
            class: inputCls,
            placeholder: 'e.g. 1+kk, balkon, novostavba',
            value: cfg.search_text,
            onInput: (e: Event) => { cfg.search_text = (e.target as HTMLInputElement).value }
          }),
          h('p', { class: hintCls }, 'Case-insensitive substring match against each listing\'s description teaser.')
        ]),

        h('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-4' }, [
          h('div', {}, [
            h('label', { class: labelCls, for: 'bazos-psc' }, 'Postal code'),
            h('input', {
              id: 'bazos-psc',
              class: inputCls,
              maxlength: 5,
              pattern: '\\d{5}',
              placeholder: '60200',
              value: cfg.psc,
              onInput: (e: Event) => { cfg.psc = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 5) }
            })
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'bazos-min' }, 'Min price (CZK)'),
            h('input', {
              id: 'bazos-min',
              class: inputCls,
              type: 'number',
              min: 0,
              step: 1000,
              value: cfg.min_price ?? '',
              onInput: (e: Event) => {
                const v = (e.target as HTMLInputElement).value
                cfg.min_price = v === '' ? null : Number(v)
              }
            })
          ]),
          h('div', {}, [
            h('label', { class: labelCls, for: 'bazos-max' }, 'Max price (CZK)'),
            h('input', {
              id: 'bazos-max',
              class: inputCls,
              type: 'number',
              min: 0,
              step: 1000,
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
