import { z } from 'zod'
import type { NotificationSpec } from '~~/shared/types'

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
