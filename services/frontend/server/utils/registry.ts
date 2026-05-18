import type { ModuleRegistryEntry } from '~~/shared/types'
import { getDb, COLLECTIONS } from './db'

interface RegistryDoc {
  bot_id: string
  display_name: string
  description: string
  base_url: string
  category?: string | null
  configure_url?: string | null
  config_collection?: string | null
}

function shape(doc: RegistryDoc): ModuleRegistryEntry {
  return {
    bot_id: doc.bot_id,
    display_name: doc.display_name,
    description: doc.description,
    base_url: doc.base_url,
    category: (doc.category && doc.category.trim()) || 'other',
    configure_url: (doc.configure_url && doc.configure_url.trim()) || '/configure',
    config_collection: (doc.config_collection && doc.config_collection.trim()) || ''
  }
}

export async function listRegistry(): Promise<ModuleRegistryEntry[]> {
  const db = await getDb()
  const docs = await db.collection<RegistryDoc>(COLLECTIONS.moduleRegistry)
    .find({}, { projection: { _id: 0 } })
    .sort({ display_name: 1 })
    .toArray()
  return docs.map(shape)
}

export async function findRegistryEntry(botId: string): Promise<ModuleRegistryEntry | null> {
  if (!botId) return null
  const db = await getDb()
  const doc = await db.collection<RegistryDoc>(COLLECTIONS.moduleRegistry)
    .findOne({ bot_id: botId }, { projection: { _id: 0 } })
  return doc ? shape(doc) : null
}

const SAFE_BOT_ID = /^[a-z][a-z0-9_-]{0,62}$/

export function isSafeBotId(name: string): boolean {
  return SAFE_BOT_ID.test(name)
}
