import { z } from 'zod'
import { requireUserId } from '~~/server/utils/auth'
import { getDb } from '~~/server/utils/db'

const DISPOSITIONS = ['1+kk', '1+1', '2+kk', '2+1', '3+kk', '3+1', '4+kk', '4+1', '5+kk', '5+1'] as const
const PRICE_TYPES = ['sale', 'rent'] as const

const querySchema = z.object({
  disposition: z.enum(DISPOSITIONS).optional(),
  price_type: z.enum(PRICE_TYPES).default('sale')
})

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
}

const COLLECTION = 'listings_sreality'

const MIN_REAL_PRICE = 1000

function quantile(sortedAsc: number[], q: number): number {
  if (!sortedAsc.length) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * q))
  return sortedAsc[idx]!
}

export default defineEventHandler(async (event): Promise<ListingsMapResponse> => {
  await requireUserId(event)

  const { disposition, price_type } = await getValidatedQuery(event, querySchema.parse)

  const match: Record<string, unknown> = {
    'price_type': price_type,
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

  if (!docs.length) {
    return {
      listings: [],
      breakpoints: [0, 0, 0, 0],
      median: 0,
      count: 0
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

  return {
    listings,
    breakpoints,
    median,
    count: docs.length
  }
})
