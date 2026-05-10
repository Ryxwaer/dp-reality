import { requireUser } from '~~/server/utils/auth'
import { shapeBot } from '~~/server/utils/bot-shape'
import type { StoredBot } from '~~/server/utils/auth'
import type { BotMeta } from '~~/shared/types'

// Returns the user's per-configuration bot rows; the `id` of each row
// in the request path (`/api/bots/[id]`) is its `config_id`. `pending`
// rows are wizard in-flight commits not yet promoted to `active` and
// are intentionally hidden from the dashboard.
export default defineEventHandler(async (event): Promise<BotMeta[]> => {
  const user = await requireUser(event)
  const bots = (user.bots ?? []) as StoredBot[]
  return bots
    .map(shapeBot)
    .filter(b => b.status !== 'deleted' && b.status !== 'pending')
})
