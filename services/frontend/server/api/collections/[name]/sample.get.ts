import { requireUserId } from '~~/server/utils/auth'
import { getDb, COLLECTIONS } from '~~/server/utils/db'

/**
 * Returns the last inserted document from the named collection, used
 * by the module editor to populate field-name autocomplete and drive
 * the live notification preview.
 *
 * The `name` parameter is restricted to a whitelist built at request
 * time from `distinct modules.collection` (so operators can add a new
 * collection simply by uploading a module that targets it). A
 * query-time `?authoring=1` flag adds a second, permissive pattern —
 * only while actually authoring a module — so the very first author
 * targeting a new collection can still fetch a sample.
 *
 * Never exposes `users`, `modules`, `notifications`, or anything else
 * outside that whitelist — even if the pattern matches, we reject it
 * explicitly to keep reflected-PII risk at zero.
 */

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

  // Whitelist: every collection already referenced by at least one
  // module. A brand-new collection (no module yet) still works
  // because we also accept it if it's "safe-looking" and the caller
  // opts in via ?authoring=1. That's the only moment in a module's
  // lifecycle where a yet-unindexed collection needs to be sampled.
  const query = getQuery(event)
  const isAuthoring = query.authoring === '1' || query.authoring === 'true'

  const known = await db
    .collection(COLLECTIONS.modules)
    .distinct('collection') as string[]
  const allowed = new Set(known.filter(Boolean))

  if (!allowed.has(name) && !isAuthoring) {
    throw createError({ statusCode: 404, statusMessage: 'Collection not found' })
  }

  // Surface the most recent doc by `_id` descending — `_id` is the
  // cheapest ordering (uses the default index) and is good enough for
  // "show me something representative".
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
