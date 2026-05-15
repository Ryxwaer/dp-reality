import { describe, it, expect } from 'vitest'
import { sanitizeNotificationHtml } from '../server/utils/sanitize-html'

describe('sanitizeNotificationHtml', () => {
  it('returns empty string for empty / null / undefined input', () => {
    expect(sanitizeNotificationHtml(null)).toBe('')
    expect(sanitizeNotificationHtml(undefined)).toBe('')
    expect(sanitizeNotificationHtml('')).toBe('')
  })

  it('strips <script> elements and their content', () => {
    expect(sanitizeNotificationHtml('<script>alert(1)</script>')).toBe('')
    const mixed = sanitizeNotificationHtml('<p>hi</p><script>x</script><p>bye</p>')
    expect(mixed).not.toMatch(/script/i)
    expect(mixed).toContain('<p>hi</p>')
    expect(mixed).toContain('<p>bye</p>')
  })

  it('strips <iframe> elements', () => {
    expect(sanitizeNotificationHtml('<iframe src="https://evil"></iframe>')).not.toMatch(/iframe/i)
  })

  it('drops javascript: URLs from img src', () => {
    const out = sanitizeNotificationHtml('<img src="javascript:alert(1)" alt="x">')
    expect(out).not.toContain('javascript:')
    // The element may survive without the bad attribute; what matters
    // is that no script vector remains.
    expect(out).not.toMatch(/src="javascript/)
  })

  it('drops data: URLs from img src', () => {
    const out = sanitizeNotificationHtml('<img src="data:text/html;base64,PHNjcmlwdD4=">')
    expect(out).not.toContain('data:')
  })

  it('drops on* event handler attributes', () => {
    const out = sanitizeNotificationHtml('<div onclick="alert(1)">x</div>')
    expect(out).not.toMatch(/onclick/i)
    expect(out).toContain('x')
  })

  it('adds rel="noopener noreferrer" to anchors with target', () => {
    const out = sanitizeNotificationHtml('<a href="https://example.com" target="_blank">x</a>')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it('does not duplicate rel when the bot already supplied one', () => {
    const out = sanitizeNotificationHtml('<a href="https://example.com" target="_blank" rel="noopener">x</a>')
    expect(out.match(/rel=/g)?.length).toBe(1)
  })

  it('drops style attributes containing url()', () => {
    const out = sanitizeNotificationHtml('<div style="background:url(http://evil/)">x</div>')
    expect(out).not.toContain('style=')
    expect(out).toContain('x')
  })

  it('drops style attributes containing expression()', () => {
    const out = sanitizeNotificationHtml('<div style="width:expression(alert(1))">x</div>')
    expect(out).not.toContain('style=')
  })

  it('keeps benign inline styles', () => {
    const out = sanitizeNotificationHtml('<div style="color:#333;padding:8px">x</div>')
    expect(out).toContain('style="color:#333;padding:8px"')
  })

  it('drops HTML comments', () => {
    const out = sanitizeNotificationHtml('<p>a</p><!-- secret --><p>b</p>')
    expect(out).not.toContain('<!--')
    expect(out).not.toContain('secret')
  })

  it('does not throw on broken markup', () => {
    expect(() => sanitizeNotificationHtml('<a href="</script>"')).not.toThrow()
    expect(() => sanitizeNotificationHtml('<<>>')).not.toThrow()
    expect(() => sanitizeNotificationHtml('<div><span>x</div>')).not.toThrow()
  })

  it('preserves a typical bot card', () => {
    const card = '<div class="card"><img src="https://cdn.example/x.jpg" alt="x" width="320" height="240"><a href="https://example.com" target="_blank">link</a><p><strong>449 000 Kč</strong></p></div>'
    const out = sanitizeNotificationHtml(card)
    expect(out).toContain('<img')
    expect(out).toContain('src="https://cdn.example/x.jpg"')
    expect(out).toContain('<a')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('<strong>449 000 Kč</strong>')
  })

  it('keeps allowed table tags intact', () => {
    const out = sanitizeNotificationHtml('<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>')
    for (const tag of ['table', 'thead', 'tbody', 'tr', 'th', 'td']) {
      expect(out).toContain(`<${tag}`)
    }
  })

  it('strips <style> elements (CSS-based exfiltration)', () => {
    const out = sanitizeNotificationHtml('<style>div{background:url(http://evil)}</style><div>x</div>')
    expect(out).not.toMatch(/<style/i)
    expect(out).toContain('x')
  })
})
