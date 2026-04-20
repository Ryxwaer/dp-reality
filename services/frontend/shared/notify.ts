/**
 * Field resolver for NotificationSpec expressions.
 *
 * Mirrors services/notification/internal/notify/resolve.go exactly so
 * the module editor's live preview shows the same text the user will
 * be emailed. Any change here must be reflected in the Go side (and
 * vice versa).
 *
 * Grammar:
 *   - A bare identifier ("title") reads doc["title"] and HTML-escapes
 *     it. Missing / null / undefined / empty → "".
 *   - A string containing "{{ ... }}" is a simple substitution
 *     template; each {{ name }} is replaced by the HTML-escaped
 *     doc[name]. Whitespace around the name is tolerated. No filters,
 *     no loops, no nested paths.
 *
 * Both paths always return an HTML-safe string.
 */

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

/**
 * Resolve a single NotificationSpec expression against a document.
 * Output is always HTML-safe.
 */
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

/**
 * Apply an entire spec to a doc. Returns null if the required title or
 * url slot resolves empty — that mirrors the Go resolver's "skip row"
 * semantics, so the preview hides rows that wouldn't actually be sent.
 */
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

/**
 * Resolve an email subject. Same grammar as row slots, plus a virtual
 * `{{count}}` placeholder exposing how many rows are in the digest.
 */
export function resolveSubject(spec: NotificationSpec, count: number): string {
  const subject = resolve(spec.subject ?? '', { count }).trim()
  if (subject === '') return 'Notification'
  return subject
}
