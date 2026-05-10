import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { mintConfigId } from '~~/server/utils/config-id'
import { findRegistryEntry } from '~~/server/utils/registry'
import { shapeBot } from '~~/server/utils/bot-shape'
import type { BotMeta } from '~~/shared/types'

const bodySchema = z.object({
  // Bot service type to create a configuration against (module_registry
  // key, e.g. "bot-bazos").
  bot_id: z.string().trim().min(1),
  // Step 1 of the wizard collects these as plain BFF metadata before
  // the iframe is even loaded; they are persisted on the new
  // users.bots[] entry directly.
  name: z.string().trim().min(1).max(100),
  email_notifications: z.boolean().optional()
})

// Step 1 of the bot-creation wizard. The BFF mints a fresh config_id
// and inserts a `status: "pending"` row into users.bots[]. The dialog
// then opens the iframe at module_registry.configure_url with that
// config_id; the bot writes its own `<bot>_config` row when the user
// saves. On `module:saved` the parent flips status to "active". If the
// user closes the dialog before saving, the parent issues DELETE
// /api/bots/:id which removes both the pending users.bots[] entry and
// any `<bot>_config` row that may have already landed; the janitor
// catches anything that escapes (e.g. tab closed at exactly the wrong
// moment).
export default defineEventHandler(async (event): Promise<BotMeta> => {
  const user = await requireUser(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  const registry = await findRegistryEntry(body.bot_id)
  if (!registry) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown bot service' })
  }

  const configId = mintConfigId()
  const now = new Date()

  const bot = {
    config_id: configId,
    bot_id: body.bot_id,
    name: body.name,
    status: 'pending' as const,
    email_notifications: body.email_notifications ?? true,
    created_at: now
  }

  const db = await getDb()
  await db.collection(COLLECTIONS.users).updateOne(
    { _id: user._id },
    { $push: { bots: bot } as never }
  )

  return shapeBot(bot)
})
