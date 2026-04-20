import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,39}$/
const ALWAYS_DENY = new Set(['users', 'modules', 'notifications'])

export default defineEventHandler(async (event) => {
  const userId = await requireUserId(event)
  void userId

  const name = getRouterParam(event, 'name') ?? ''
  if (!COLLECTION_PATTERN.test(name)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid collection name' })
  }
  if (ALWAYS_DENY.has(name)) {
    throw createError({ statusCode: 403, statusMessage: 'Collection not browsable' })
  }

  const db = await getDb()

  const query = getQuery(event)
  const isAuthoring = query.authoring === '1' || query.authoring === 'true'

  const known = await db
    .collection(COLLECTIONS.modules)
    .distinct('collection') as string[]
  const allowed = new Set(known.filter(Boolean))

  if (!allowed.has(name) && !isAuthoring) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  const doc = await db
    .collection(name)
    .find({}, { projection: { _id: 0 } })
    .sort({ _id: -1 })
    .limit(1)
    .next()

  if (!doc) {
    return { found: false, keys: [], sample: null }
  }

  const keys = Object.keys(doc).sort()
  return {
    found: true,
    keys,
    sample: doc
  }
})
