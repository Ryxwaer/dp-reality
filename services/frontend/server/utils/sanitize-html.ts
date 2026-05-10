// Server-side HTML sanitization for bot-authored notification cards.
//
// Bot services emit inline-styled HTML (`notifications.html`) following
// the platform's HTML conventions document: no scripts, no event
// handlers, only a small whitelist of structural tags + style/href on
// anchors. We re-validate that here at read time so a compromised or
// misbehaving bot cannot inject script into other users' inboxes.

const ALLOWED_TAGS = new Set([
  'a', 'b', 'br', 'div', 'em', 'i', 'img', 'li', 'ol', 'p', 'span',
  'strong', 'small', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
])

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'style']),
  img: new Set(['src', 'alt', 'width', 'height', 'style']),
  '*': new Set(['style', 'class'])
}

const URL_SCHEMES = /^(https?:|mailto:|tel:)/i

const VOID_TAGS = new Set(['br', 'img'])

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttrValue(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attrAllowed(tag: string, name: string): boolean {
  const wildcard = ALLOWED_ATTRS['*']
  if (wildcard?.has(name)) return true
  return ALLOWED_ATTRS[tag]?.has(name) ?? false
}

function urlAllowed(value: string): boolean {
  // Allow protocol-relative + absolute http(s); reject javascript:/data:
  // Anything we cannot reason about is rejected outright.
  const trimmed = value.trim()
  if (trimmed.startsWith('//')) return true
  if (trimmed.startsWith('/')) return true
  if (trimmed.startsWith('#')) return true
  return URL_SCHEMES.test(trimmed)
}

function styleAllowed(value: string): string | null {
  // Bot HTML uses inline styles heavily for email compatibility; we
  // strip url(...) and expression(...) to defang CSS-based exfiltration.
  const lowered = value.toLowerCase()
  if (lowered.includes('url(') || lowered.includes('expression(')) return null
  if (lowered.includes('javascript:')) return null
  return value
}

interface RenderedAttr {
  name: string
  value: string
}

function renderAttrs(tag: string, attrs: RenderedAttr[]): string {
  const out: string[] = []
  for (const { name, value } of attrs) {
    if (!attrAllowed(tag, name)) continue
    let v = value
    if (name === 'href' || name === 'src') {
      if (!urlAllowed(v)) continue
    }
    if (name === 'style') {
      const cleaned = styleAllowed(v)
      if (cleaned === null) continue
      v = cleaned
    }
    out.push(`${name}="${escapeAttrValue(v)}"`)
  }
  // a-tag: if target present, always emit safe rel (avoids tabnabbing)
  if (tag === 'a') {
    const hasTarget = out.some(a => a.startsWith('target='))
    const hasRel = out.some(a => a.startsWith('rel='))
    if (hasTarget && !hasRel) out.push('rel="noopener noreferrer"')
  }
  return out.length ? ' ' + out.join(' ') : ''
}

const TAG_RE = /<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9:._-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g

function parseAttrs(raw: string): RenderedAttr[] {
  const attrs: RenderedAttr[] = []
  let match: RegExpExecArray | null
  ATTR_RE.lastIndex = 0
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = match[1]?.toLowerCase()
    const value = match[3] ?? match[4] ?? match[5] ?? ''
    if (!name || name.startsWith('on') || name === 'srcdoc' || name === 'formaction') continue
    attrs.push({ name, value })
  }
  return attrs
}

/**
 * Sanitize `html` for safe v-html on the inbox UI. Whitelists tags
 * and attributes; everything else is dropped. This is a deliberately
 * narrow allow-list — the bot HTML conventions document requires the
 * same set, so legitimate cards round-trip unchanged.
 */
export function sanitizeNotificationHtml(html: string | null | undefined): string {
  if (!html) return ''
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null
  TAG_RE.lastIndex = 0
  while ((match = TAG_RE.exec(html)) !== null) {
    const text = html.slice(lastIndex, match.index)
    if (text) result += escapeText(text)
    lastIndex = match.index + match[0].length

    const isClosing = match[0].startsWith('</')
    const tag = match[1]?.toLowerCase()
    if (!tag || !ALLOWED_TAGS.has(tag)) continue

    if (isClosing) {
      result += `</${tag}>`
      continue
    }

    const attrs = parseAttrs(match[2] ?? '')
    const rendered = renderAttrs(tag, attrs)
    if (VOID_TAGS.has(tag)) {
      result += `<${tag}${rendered}/>`
    } else {
      result += `<${tag}${rendered}>`
    }
  }
  if (lastIndex < html.length) {
    result += escapeText(html.slice(lastIndex))
  }
  return result
}
