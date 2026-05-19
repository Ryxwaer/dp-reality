import { getDb } from '~~/server/utils/db'

export const HEATMAP_COMBINATIONS = {
  dispositions: ['1+kk', '1+1', '2+kk', '2+1', '3+kk', '3+1', '4+kk', '4+1', '5+kk', '5+1'] as const,
  priceTypes: ['sale', 'rent'] as const
}

export type Disposition = typeof HEATMAP_COMBINATIONS.dispositions[number]
export type PriceType = typeof HEATMAP_COMBINATIONS.priceTypes[number]

export interface MapListing {
  id: string
  lat: number
  lon: number
  price: number
  title: string
  url: string
  disposition?: string
  locality?: string
}

export interface ListingsMapResponse {
  listings: MapListing[]
  breakpoints: [number, number, number, number]
  median: number
  count: number
  generated_at: string
}

interface CacheEntry {
  data: ListingsMapResponse
  generated_at: number
}

const COLLECTION = 'listings_sreality'
const MIN_REAL_PRICE = 1000
const CACHE_NAMESPACE = 'heatmap'
const FRESH_TTL_MS = 60 * 60 * 1000

const inflightRefreshes = new Map<string, Promise<void>>()

function cacheKey(priceType: PriceType, disposition: Disposition | null): string {
  return `${CACHE_NAMESPACE}:${priceType}:${disposition ?? 'all'}`
}

function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * q))
  return sortedAsc[idx]!
}

async function computeHeatmap(
  priceType: PriceType,
  disposition: Disposition | null
): Promise<ListingsMapResponse> {
  const match: Record<string, unknown> = {
    'price_type': priceType,
    'price': { $gt: MIN_REAL_PRICE },
    'gps.coordinates': { $exists: true }
  }

  if (disposition) {
    match.disposition = disposition
    match.property_type = 'apartment'
  }

  const db = await getDb()
  const col = db.collection(COLLECTION)

  const docs = await col.aggregate<{
    _id: string
    price: number
    title: string
    url: string
    disposition?: string
    locality?: string
    coords: [number, number]
  }>([
    { $match: match },
    {
      $project: {
        _id: 1,
        price: 1,
        title: 1,
        url: '$source_url',
        disposition: 1,
        locality: 1,
        coords: '$gps.coordinates'
      }
    }
  ]).toArray()

  const generated_at = new Date().toISOString()

  if (!docs.length) {
    return {
      listings: [],
      breakpoints: [0, 0, 0, 0],
      median: 0,
      count: 0,
      generated_at
    }
  }

  const sortedPrices = docs.map(d => d.price).sort((a, b) => a - b)
  const breakpoints: [number, number, number, number] = [
    quantile(sortedPrices, 0.2),
    quantile(sortedPrices, 0.4),
    quantile(sortedPrices, 0.6),
    quantile(sortedPrices, 0.8)
  ]
  const median = quantile(sortedPrices, 0.5)

  const listings: MapListing[] = docs.map((d) => {
    const [lon, lat] = d.coords
    return {
      id: d._id,
      lat,
      lon,
      price: d.price,
      title: d.title,
      url: d.url,
      disposition: d.disposition,
      locality: d.locality
    }
  })

  return { listings, breakpoints, median, count: docs.length, generated_at }
}

async function refreshAndStore(
  priceType: PriceType,
  disposition: Disposition | null,
  key: string
): Promise<void> {
  const data = await computeHeatmap(priceType, disposition)
  const entry: CacheEntry = { data, generated_at: Date.now() }
  await useStorage('cache').setItem(key, entry)
}

function scheduleBackgroundRefresh(
  priceType: PriceType,
  disposition: Disposition | null,
  key: string
): void {
  if (inflightRefreshes.has(key)) return
  const promise = refreshAndStore(priceType, disposition, key)
    .catch((err) => {
      console.error(`[heatmap] background refresh failed for ${key}`, err)
    })
    .finally(() => {
      inflightRefreshes.delete(key)
    })
  inflightRefreshes.set(key, promise)
}

/**
 * Read the heatmap from cache. Behaviour:
 *  - Cache empty (cold start): compute synchronously, cache, return.
 *  - Cache present and within FRESH_TTL_MS: return immediately, no refresh.
 *  - Cache present but stale: return immediately, kick off a background
 *    refresh so the next caller gets fresh data.
 *
 * No timers, no background work without traffic.
 */
export async function getHeatmap(
  priceType: PriceType,
  disposition: Disposition | null
): Promise<ListingsMapResponse> {
  const storage = useStorage('cache')
  const key = cacheKey(priceType, disposition)
  const entry = await storage.getItem<CacheEntry>(key)

  if (!entry) {
    const data = await computeHeatmap(priceType, disposition)
    await storage.setItem(key, { data, generated_at: Date.now() } satisfies CacheEntry)
    return data
  }

  const age = Date.now() - entry.generated_at
  if (age > FRESH_TTL_MS) {
    scheduleBackgroundRefresh(priceType, disposition, key)
  }

  return entry.data
}
