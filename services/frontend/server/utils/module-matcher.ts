import { z } from 'zod'
import { FILTER_OPS } from '~~/shared/types'
import type { ModuleMatcher, ModuleFilterSpec } from '~~/shared/types'

/**
 * Strict validator for a compiled bot matcher. The module's `.mjs`
 * produces this at save time with user config already inlined — there
 * is no `config.*` interpolation at run time. The server validates
 * shape only (never semantics) because:
 *
 *   1. `op` is constrained to {@link FILTER_OPS} — excludes `$where`,
 *      `$expr`, and every operator that could evaluate code. Even
 *      `contains` is a bounded substring match emitted as a
 *      literal-escaped regex on the Go side, not an author-supplied
 *      pattern.
 *   2. `field` must match {@link FIELD_PATTERN}: a dotted path of
 *      identifiers at most 4 segments deep. `$`, `[`, `]`, spaces, and
 *      leading digits are rejected — so no `$where`, no array-index
 *      expressions, no operator confusion at the field slot.
 *   3. Literal `value` is constrained to primitives (strings <= 256 chars,
 *      numbers, booleans), arrays of primitives (<= 256 elements), or
 *      the `geo_within` struct `{ center: [lon, lat], radius_km }`.
 *   4. Max 32 filters per matcher — bumped from 16 because authors now
 *      emit concrete values (no templating loops).
 *
 * The set of legal field names is not known in advance; modules can
 * target any collection. Safety comes from the operator whitelist and
 * the field-name pattern, not a per-field allowlist.
 *
 * The Go notifier mirrors this schema in `specmatcher/`.
 */

export const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,3}$/

const PRIMITIVE = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean()
])

/**
 * Geo-radius value. Shape mirrors {@link GeoWithinValue} and the
 * Mongo `$centerSphere: [[lon, lat], radians]` order. Radius is
 * clamped to a sane upper bound so a bug in the module can't
 * match the entire globe.
 */
const GEO_VALUE = z.object({
  center: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90)
  ]),
  radius_km: z.number().positive().max(500)
})

const PRIMITIVE_VALUE = z.union([
  PRIMITIVE,
  z.array(PRIMITIVE).max(256)
])

const FILTER = z.object({
  field: z.string().max(128).regex(FIELD_PATTERN, {
    message: '`field` must be a dotted path of identifiers (≤ 4 segments)'
  }),
  op: z.enum(FILTER_OPS),
  value: z.union([PRIMITIVE_VALUE, GEO_VALUE]).optional(),
  ci: z.boolean().optional()
}).superRefine((f, ctx) => {
  if (f.op === 'exists') {
    if (f.ci) {
      ctx.addIssue({ code: 'custom', message: '`ci` not valid on `exists`' })
    }
    return
  }
  if (f.value === undefined) {
    ctx.addIssue({ code: 'custom', message: 'filter must specify `value` (unless op === "exists")' })
    return
  }

  if (f.op === 'geo_within') {
    const parsed = GEO_VALUE.safeParse(f.value)
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: '`geo_within` needs { center: [lon, lat], radius_km }' })
    }
    if (f.ci) {
      ctx.addIssue({ code: 'custom', message: '`ci` not valid on `geo_within`' })
    }
    return
  }

  // Every non-geo op expects a primitive or primitive-array value.
  const parsed = PRIMITIVE_VALUE.safeParse(f.value)
  if (!parsed.success) {
    ctx.addIssue({ code: 'custom', message: `op \`${f.op}\` expects a primitive or array-of-primitives value` })
    return
  }

  if (f.op === 'contains') {
    if (typeof f.value !== 'string' || f.value.length === 0) {
      ctx.addIssue({ code: 'custom', message: '`contains` needs a non-empty string value' })
    }
    // `ci` is accepted on `contains` and advisory — the Go compiler
    // always emits the `i` regex flag regardless (no non-ci variant
    // exposed on the wire, but allowing the flag keeps the client
    // side uniform with in/nin/eq/ne).
    return
  }

  if (f.ci && f.op !== 'in' && f.op !== 'nin' && f.op !== 'eq' && f.op !== 'ne') {
    ctx.addIssue({ code: 'custom', message: '`ci` only valid on in/nin/eq/ne/contains' })
  }
})

export const MATCHER_SCHEMA: z.ZodType<ModuleMatcher> = z.object({
  filters: z.array(FILTER).max(32)
})

export type { ModuleFilterSpec, ModuleMatcher }
