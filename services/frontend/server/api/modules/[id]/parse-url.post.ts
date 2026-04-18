import { getDb } from "../../../utils/db"
import { getModuleClient, callUnary } from "../../../utils/grpc"

export default defineEventHandler(async (event) => {
  const moduleId = getRouterParam(event, "id")
  const body = await readBody<{ url: string }>(event)

  if (!body?.url) {
    throw createError({ statusCode: 400, message: "url is required" })
  }

  const db = await getDb()
  const mod = await db.collection("modules").findOne({ module_id: moduleId })
  if (!mod) {
    throw createError({ statusCode: 404, message: `Module "${moduleId}" not found` })
  }

  const client = getModuleClient(mod.grpc_address)
  const result = await callUnary<any>(client, "ParseUrl", { url: body.url })

  return {
    name: result.name,
    cities: result.cities,
    propertyTypes: result.property_types,
    priceTypes: result.price_types,
    minPrice: result.min_price || null,
    maxPrice: result.max_price || null,
    dispositions: result.dispositions,
    warnings: result.warnings,
  }
})
