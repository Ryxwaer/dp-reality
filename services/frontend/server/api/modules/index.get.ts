import type { Document } from 'mongodb'
import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'
import { ensureSeededModules } from '~~/server/utils/seed-modules'

interface ModuleListItem {
  id: string
  name: string
  description: string
  collection: string
  source: string
  uploaded_by: string
  uploaded_by_name: string
  created_at: string
  updated_at: string
  is_own: boolean
  // `system: true` marks repo-seeded modules (Bazos / Sreality). Keep
  // surfaced so the UI can badge them and lock their bundle upload.
  system: boolean
  // `editable: true` when the current user can PATCH the module.
  // Mirrors the server-side auth rule so we can render the right
  // dropdown actions without a round-trip.
  editable: boolean
}

interface AggregatedDoc extends Document {
  _id: import('mongodb').ObjectId
  name: string
  description: string
  collection?: string
  source?: string
  uploaded_by: import('mongodb').ObjectId
  created_at: Date
  updated_at: Date
  uploader?: { name?: string }
  system?: boolean
  system_author?: string
}

export default defineEventHandler(async (event): Promise<ModuleListItem[]> => {
  const userId = await requireUserId(event)

  try {
    await ensureSeededModules()
  } catch (err) {
    console.error('[modules.get] seeding failed, continuing with existing modules:', err)
  }

  const db = await getDb()

  const docs = await db.collection<AggregatedDoc>(COLLECTIONS.modules).aggregate<AggregatedDoc>([
    { $sort: { created_at: -1 } },
    {
      $lookup: {
        from: COLLECTIONS.users,
        localField: 'uploaded_by',
        foreignField: '_id',
        as: 'uploader',
        pipeline: [{ $project: { _id: 0, name: 1 } }]
      }
    },
    { $unwind: { path: '$uploader', preserveNullAndEmptyArrays: true } },
    { $project: { code: 0 } }
  ]).toArray()

  return docs.map((d) => {
    const uploaderName = d.system
      ? (d.system_author ?? 'dp-reality')
      : (d.uploader?.name ?? 'Unknown')
    const isOwn = !d.system && d.uploaded_by.equals(userId)
    return {
      id: d._id.toHexString(),
      name: d.name,
      description: d.description,
      collection: d.collection ?? '',
      source: d.source ?? '',
      uploaded_by: d.uploaded_by.toHexString(),
      uploaded_by_name: uploaderName,
      created_at: d.created_at.toISOString(),
      updated_at: d.updated_at.toISOString(),
      is_own: isOwn,
      system: d.system === true,
      // While single-tenant dev, any signed-in user may edit system
      // modules; owners may always edit their own. The PATCH handler
      // re-enforces this so a stale cache can't bypass the check.
      editable: isOwn || d.system === true
    }
  })
})
