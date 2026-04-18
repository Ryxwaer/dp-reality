import { getDb } from "../../../utils/db"
import { getModuleClient, callUnary } from "../../../utils/grpc"

export default defineEventHandler(async (event) => {
  const moduleId = getRouterParam(event, "id")

  const db = await getDb()
  const mod = await db.collection("modules").findOne({ module_id: moduleId })
  if (!mod) {
    throw createError({ statusCode: 404, message: `Module "${moduleId}" not found` })
  }

  const client = getModuleClient(mod.grpc_address)
  const result = await callUnary<{ json_schema: string }>(client, "GetConfigSchema", {})

  return JSON.parse(result.json_schema)
})
