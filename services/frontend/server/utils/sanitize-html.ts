import DOMPurify from 'isomorphic-dompurify'

const ALLOWED_TAGS = [
  'a', 'b', 'br', 'div', 'em', 'i', 'img', 'li', 'ol', 'p', 'span',
  'strong', 'small', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul'
]

const ALLOWED_ATTR = [
  'style', 'class', 'href', 'target', 'rel', 'src', 'alt', 'width', 'height'
]

const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'link', 'meta', 'style']

const FORBID_ATTR = ['srcdoc', 'formaction']

const URI_ATTRS = new Set(['href', 'src', 'xlink:href'])
const SAFE_URI_RE = /^(?:https?:|mailto:|tel:|#|\/)/i

const SAFE_TARGETS = new Set(['_blank', '_self', '_parent', '_top'])

const DANGEROUS_STYLE_PATTERNS = [
  /url\s*\(/i,
  /expression\s*\(/i,
  /javascript\s*:/i
]

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
  return html.replace(/<a\b([^>]*?)>/gi, (full, attrs: string) => {
    if (!/\btarget\s*=/i.test(attrs)) return full
    if (/\brel\s*=/i.test(attrs)) return full
    return `<a${attrs} rel="noopener noreferrer">`
  })
}

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
