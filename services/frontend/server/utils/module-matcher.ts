import { z } from 'zod'
import { FILTER_OPS } from '~~/shared/types'
import type { ModuleMatcher, ModuleFilterSpec } from '~~/shared/types'

export const FIELD_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*){0,3}$/

const PRIMITIVE = z.union([
  z.string().max(256),
  z.number().finite(),
  z.boolean()
])

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

  const parsed = PRIMITIVE_VALUE.safeParse(f.value)
  if (!parsed.success) {
    ctx.addIssue({ code: 'custom', message: `op \`${f.op}\` expects a primitive or array-of-primitives value` })
    return
  }

  if (f.op === 'contains') {
    if (typeof f.value !== 'string' || f.value.length === 0) {
      ctx.addIssue({ code: 'custom', message: '`contains` needs a non-empty string value' })
    }
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
