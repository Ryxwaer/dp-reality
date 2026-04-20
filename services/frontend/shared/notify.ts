// Mirror of services/notification/internal/notify/resolve.go — any
// change here must be mirrored in the Go resolver so the preview and
// email render identically.
import type { NotificationField, NotificationSpec } from './types'

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
const BARE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function htmlEscape(v: string): string {
  return v
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return String(v)
}

export function resolve(expr: string, doc: Record<string, unknown>): string {
  const trimmed = expr.trim()
  if (trimmed === '') return ''
  if (BARE_IDENTIFIER.test(trimmed)) {
    return htmlEscape(stringify(doc[trimmed]))
  }
  return expr.replace(PLACEHOLDER, (_, name: string) =>
    htmlEscape(stringify(doc[name]))
  )
}

export interface ResolvedRow {
  title: string
  url: string
  fields: NotificationField[]
}

export function apply(spec: NotificationSpec, doc: Record<string, unknown>): ResolvedRow | null {
  const title = resolve(spec.title ?? '', doc).trim()
  const url = resolve(spec.url ?? '', doc).trim()
  if (title === '' || url === '') return null
  const fields: NotificationField[] = []
  for (const f of spec.fields ?? []) {
    const v = resolve(f.value ?? '', doc).trim()
    if (v === '') continue
    fields.push({ label: f.label, value: v })
  }
  return { title, url, fields }
}

export function resolveSubject(spec: NotificationSpec, count: number): string {
  const subject = resolve(spec.subject ?? '', { count }).trim()
  if (subject === '') return 'Notification'
  return subject
}
