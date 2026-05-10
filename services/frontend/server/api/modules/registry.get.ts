import { listRegistry } from '~~/server/utils/registry'

// Public listing of installed bot services for the dashboard "add bot"
// dropdown. Reads module_registry, which is populated by each bot
// service on boot via self-registration.
export default defineEventHandler(async () => {
  const items = await listRegistry()
  return { items }
})
