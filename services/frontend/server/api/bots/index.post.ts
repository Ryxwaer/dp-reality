import { z } from 'zod'
import { requireUser } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { mintConfigId } from '~~/server/utils/config-id'
import { findRegistryEntry } from '~~/server/utils/registry'
import { shapeBot } from '~~/server/utils/bot-shape'
import type { BotMeta } from '~~/shared/types'

const bodySchema = z.object({
  bot_id: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  email_notifications: z.boolean().optional()
})

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
