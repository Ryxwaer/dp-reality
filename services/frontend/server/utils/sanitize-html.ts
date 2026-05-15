import DOMPurify from 'isomorphic-dompurify'

/**
 * Server-side HTML sanitiser for bot-authored notification cards.
 *
 * Bot services emit inline-styled HTML in `notifications.html` following
 * the platform's HTML conventions document — a small whitelist of
 * structural tags, anchor/img attributes, and inline styles. We
 * re-validate that here at read time so a compromised or misbehaving
 * bot cannot inject script (or behavioural CSS) into other users'
 * inboxes. The exported function name and signature match the previous
 * regex-based parser so every existing caller keeps compiling.
 *
 * Thesis reference §3.7.5 ("DOMPurify-equivalent server-side sanitiser
 * that strips `<script>`, `<iframe>`, and event-handler attributes"):
 * the swap to `isomorphic-dompurify` removes the interpretation argument
 * and lets the parse-tree library do the work a hand-rolled regex
 * cannot do safely against malformed input.
 */

const ALLOWED_TAGS = [
  'a', 'b', 'br', 'div', 'em', 'i', 'img', 'li', 'ol', 'p', 'span',
  'strong', 'small', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
]

const ALLOWED_ATTR = [
  'style', 'class', 'href', 'target', 'rel', 'src', 'alt', 'width', 'height'
]

// Bot HTML never embeds these; listing them explicitly is defence in
// depth so that a future change to ALLOWED_TAGS cannot accidentally let
// any of them through.
const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style']

// DOMPurify drops `on*` handlers by default; we add the two non-handler
// attributes that historically have been used to smuggle code in.
const FORBID_ATTR = ['srcdoc', 'formaction']

// URI-bearing attributes we want to validate. DOMPurify already strips
// `javascript:` in these as a built-in defence; we additionally reject
// `data:` (which DOMPurify allows for image MIME types) and anything
// not matching our explicit allow-list of schemes.
const URI_ATTRS = new Set(['href', 'src', 'xlink:href'])
const SAFE_URI_RE = /^(?:https?:|mailto:|tel:|#|\/)/i

// Allowed `target` values; arbitrary strings here are a known XSS vector
// in some browser-CSP combinations.
const SAFE_TARGETS = new Set(['_blank', '_self', '_parent', '_top'])

// CSS substrings that have been used as bypass paths even when wrapped
// in seemingly benign style attributes. We post-process the output to
// drop any inline style containing one of these, since DOMPurify does
// not inspect the contents of the style string.
const DANGEROUS_STYLE_PATTERNS = [
  /url\s*\(/i,
  /expression\s*\(/i,
  /javascript\s*:/i
]

// DOMPurify hooks are global. Register the URI/target check exactly
// once at module load — the boolean guard is for hot-reload paths
// where this file might be re-evaluated inside the same Bun/Node
// process (Nitro dev mode, vitest watch).
let HOOK_INSTALLED = false
function installAttributeHook(): void {
  if (HOOK_INSTALLED) return
  HOOK_INSTALLED = true
  DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
    if (URI_ATTRS.has(data.attrName)) {
      if (!SAFE_URI_RE.test(data.attrValue)) {
        data.keepAttr = false
      }
      return
    }
    if (data.attrName === 'target') {
      if (!SAFE_TARGETS.has(data.attrValue.toLowerCase())) {
        data.keepAttr = false
      }
    }
  })
}

installAttributeHook()

function defangStyleAttributes(html: string): string {
  return html.replace(
    /(\s)style\s*=\s*("([^"]*)"|'([^']*)')/gi,
    (match, leading: string, _full: string, dq: string | undefined, sq: string | undefined) => {
      const value = dq ?? sq ?? ''
      if (DANGEROUS_STYLE_PATTERNS.some(rx => rx.test(value))) {
        return leading
      }
      return match
    }
  )
}

function addRelToTargetAnchors(html: string): string {
  // The whitelist permits `<a target="_blank">`; without rel the page
  // is exposed to reverse-tabnabbing. DOMPurify does NOT inject rel,
  // so we tack on the safe pair after the parse-tree pass.
  return html.replace(/<a\b([^>]*?)>/gi, (full, attrs: string) => {
    if (!/\btarget\s*=/i.test(attrs)) return full
    if (/\brel\s*=/i.test(attrs)) return full
    return `<a${attrs} rel="noopener noreferrer">`
  })
}

/**
 * Sanitise `html` for safe `v-html` rendering on the inbox UI.
 * Anything outside the documented bot HTML conventions is dropped.
 */
export function sanitizeNotificationHtml(html: string | null | undefined): string {
  if (!html) return ''
  const clean = DOMPurify.sanitize(String(html), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORBID_TAGS,
    FORBID_ATTR,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false,
    USE_PROFILES: false
  }) as string
  return addRelToTargetAnchors(defangStyleAttributes(clean))
}
