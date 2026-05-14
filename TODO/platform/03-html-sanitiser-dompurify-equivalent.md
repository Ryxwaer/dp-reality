# platform/03 — Replace regex HTML sanitiser with a DOMPurify-equivalent library

## Goal
Honour thesis §3.7.5: the server-side sanitiser of bot-authored
`notifications.html` is supposed to be DOMPurify-equivalent. The
current implementation is a hand-rolled regex parser and cannot meet
that bar against malformed or adversarial HTML.

## Thesis references
- `03-architecture-design.tex` §3.7.5 "Output Encoding and the
  Bot-Authored HTML Trust Boundary":
  > "The BFF passes it through a server-side HTML sanitiser
  > (DOMPurify-equivalent) that strips `<script>` elements, `<iframe>`
  > elements, and event-handler attributes …"

## Current state
- `services/frontend/server/utils/sanitize-html.ts` is a ~150-line
  regex-based whitelist parser. Its `TAG_RE` does not cope with
  multi-line tags, attributes containing `>`, CDATA, comments, or
  partial / overlapping tags.
- It is called from `server/api/notifications.get.ts` and is the only
  sanitiser between the bot's `html` field and the browser's
  `v-html`.

## Scope
In: swap the implementation for a parse-tree sanitiser, keep the
exact same exported function name + signature
(`sanitizeNotificationHtml(html: string | null | undefined): string`),
keep the same whitelist (tags + attrs) as a configuration object, add
tests that prove the parity.
Out: changing what the bot services produce. Out: client-side
sanitisation in `MarkdownPanel.vue` (different concern, different
input).

## Concrete changes

### 1. Pick a library
Use `isomorphic-dompurify` (it bundles `jsdom` for the server path and
falls back to the real `DOMPurify` in the browser). Add it to
`services/frontend/package.json` dependencies. Do **not** use the
plain `dompurify` package alone — its server path requires `jsdom`
wiring that this package already does.

Reject alternatives: `sanitize-html` is fine but the thesis literally
says "DOMPurify-equivalent", so using DOMPurify removes the
interpretation argument.

### 2. Replace the implementation
Rewrite `server/utils/sanitize-html.ts` to:
1. Import `DOMPurify` from `isomorphic-dompurify`.
2. Configure with:
   - `ALLOWED_TAGS`: the existing list from the current file
     (`a, b, br, div, em, i, img, li, ol, p, span, strong, small,
      table, tbody, td, th, thead, tr, ul`).
   - `ALLOWED_ATTR`: `style, class, href, target, rel, src, alt,
      width, height`.
   - `ALLOWED_URI_REGEXP`: `^(https?:|mailto:|tel:|#|/)`.
   - `FORBID_TAGS`: `script, iframe, object, embed, link, meta, style`
     (defence in depth even though they're not in `ALLOWED_TAGS`).
   - `FORBID_ATTR`: `srcdoc, formaction` + every `on*` attribute
     (DOMPurify strips event handlers by default; list them anyway).
3. After DOMPurify, post-process anchors: any `<a>` with `target=` but
   no `rel=` gets `rel="noopener noreferrer"` added. The current code
   does this; preserve the behaviour.
4. Style attribute: keep the existing defang against `url(`,
   `expression(`, and `javascript:` substrings — DOMPurify does NOT
   sanitise the contents of `style` strings, only their presence.

Export the same function signature so all callers remain unchanged.

### 3. Tests
Add `services/frontend/test/sanitize-html.test.ts` (set up Vitest if
missing — minimal `vitest.config.ts`, add `test` script). Cases:
- A typical Bazos/Sreality card round-trips with no structural changes
  (use fixture HTML pulled verbatim from
  `services/bot-bazos/src/notifications.py::render_card`).
- `<script>alert(1)</script>` is stripped to empty.
- `<img src="javascript:alert(1)">` becomes `<img>` with no `src`.
- `<a href="https://example.com" target="_blank">x</a>` ends up with
  `rel="noopener noreferrer"`.
- `<div style="background:url(http://evil/)">` has its `style`
  dropped.
- Comments `<!-- … -->` are dropped.
- Broken markup `<a href="</script>"` doesn't crash and doesn't yield
  an open `<a>` injection.

### 4. Remove dead code
Drop every helper in the old file (`TAG_RE`, `ATTR_RE`, `parseAttrs`,
`renderAttrs`, `escapeText`, `escapeAttrValue`, `attrAllowed`,
`urlAllowed`, `styleAllowed`, `VOID_TAGS`, `ALLOWED_TAGS`,
`ALLOWED_ATTRS`) — DOMPurify handles all of it.

## Acceptance criteria
- `services/frontend/server/api/notifications.get.ts` still returns
  the same shape and the bot-produced cards still render visually in
  the inbox.
- Vitest suite passes.
- Bundle still builds; the SSR entry point can import the sanitiser
  without `jsdom` errors (this is what `isomorphic-dompurify` solves
  for us — verify in `nuxt build`).

## Open questions
- **Cost of jsdom on cold start.** `isomorphic-dompurify` pulls in
  `jsdom` (~2 MB). Not a blocker; flag if start-up SLO is tight.
