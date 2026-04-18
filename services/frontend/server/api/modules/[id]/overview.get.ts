import { getDb } from "../../../utils/db"
import { getModuleClient, callUnary } from "../../../utils/grpc"

export default defineEventHandler(async (event) => {
  const moduleId = getRouterParam(event, "id")
  const userId = getQuery(event).userId as string ?? ""

  const db = await getDb()
  const mod = await db.collection("modules").findOne({ module_id: moduleId })
  if (!mod) {
    throw createError({ statusCode: 404, message: `Module "${moduleId}" not found` })
  }

  const client = getModuleClient(mod.grpc_address)
  const result = await callUnary<any>(client, "GetOverview", { user_id: userId })

  return {
    totalListings: result.total_listings,
    newLast24h: result.new_last_24h,
    topCities: (result.top_cities ?? []).map((s: any) => ({ label: s.label, count: s.count })),
    topTypes: (result.top_types ?? []).map((s: any) => ({ label: s.label, count: s.count })),
    extraHtml: result.extra_html,
  }
})
