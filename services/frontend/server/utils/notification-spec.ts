import { z } from 'zod'
import type { NotificationSpec } from '~~/shared/types'

/**
 * Zod validator for a module's NotificationSpec.
 *
 * Every `value` / `subject` / `title` / `url` field is a plain string
 * carrying either a bare identifier (one snake_case / camelCase word)
 * or a simple `{{ field }}` substitution template. The resolver
 * (services/notification/internal/notify and shared/notify.ts) is the
 * only consumer — it deliberately rejects filters, loops, and nested
 * paths, so there's nothing here that could be interpreted as code.
 * The schema caps length so a single field can't balloon the module
 * document.
 *
 * `fields` is a repeater; we cap at 16 rows per email so one module
 * can't blow up the inbox layout with 200 rows per listing.
 */

const EXPR = z.string().max(512)
const LABEL = z.string().trim().min(1).max(80)

export const NOTIFICATION_FIELD_SCHEMA = z.object({
  label: LABEL,
  value: EXPR
})

export const NOTIFICATION_SCHEMA: z.ZodType<NotificationSpec> = z.object({
  subject: EXPR,
  title: EXPR,
  url: EXPR,
  fields: z.array(NOTIFICATION_FIELD_SCHEMA).max(16)
})
