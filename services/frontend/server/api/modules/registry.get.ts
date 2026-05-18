import { listRegistry } from '~~/server/utils/registry'

export default defineEventHandler(async () => {
  const items = await listRegistry()
  return { items }
})
