import { z } from 'zod'
import { requireUserId } from '~~/server/utils/auth'
import {
  HEATMAP_COMBINATIONS,
  getHeatmap,
  type ListingsMapResponse
} from '~~/server/utils/listings-heatmap'

const DISPOSITIONS = HEATMAP_COMBINATIONS.dispositions
const PRICE_TYPES = HEATMAP_COMBINATIONS.priceTypes

const querySchema = z.object({
  disposition: z.enum(DISPOSITIONS).optional(),
  price_type: z.enum(PRICE_TYPES).default('sale')
})

export type { ListingsMapResponse, MapListing } from '~~/server/utils/listings-heatmap'

export default defineEventHandler(async (event): Promise<ListingsMapResponse> => {
  await requireUserId(event)

  const { disposition, price_type } = await getValidatedQuery(event, querySchema.parse)

  return getHeatmap(price_type, disposition ?? null)
})
