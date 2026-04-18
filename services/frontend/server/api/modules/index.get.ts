import { getDb } from "../../utils/db"

export default defineEventHandler(async () => {
  const db = await getDb()
  const modules = await db.collection("modules").find({}).toArray()
  return modules.map((m) => ({
    id: m.module_id,
    displayName: m.display_name,
    description: m.description,
    iconUrl: m.icon_url,
    urlPatterns: m.url_patterns,
    grpcAddress: m.grpc_address,
  }))
})
