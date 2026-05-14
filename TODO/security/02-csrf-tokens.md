# security/02 — CSRF tokens on state-changing routes (incl. proxied iframe POSTs)

## Goal
Honour thesis §3.7.3: state-changing operations must be protected by
CSRF tokens, and the token must transparently propagate through the
BFF reverse-proxy into the bot-served iframe so the bot does not have
to re-implement CSRF.

## Thesis references
- `03-architecture-design.tex` §3.7.3 Authentication and Session
  Management:
  > "state-changing operations are protected by CSRF tokens. The CSRF
  > token is forwarded transparently when the BFF reverse-proxies
  > form submissions into a bot-served iframe, so the protection
  > extends to the bot's own configuration endpoints without the bot
  > needing to re-implement it."

## Current state
- No CSRF middleware. No token issuance. No header propagation.
- The session cookie is `SameSite=Lax` (after security/01) which
  blocks cross-site form POSTs in most modern browsers but is not
  the contract the thesis claims.
- The `/modules/<bot_id>/*` reverse proxy at
  `server/utils/module-proxy.ts` forwards everything except `Host`,
  `Connection`, `Content-Length`, and `Cookie`.

## Scope
In: a double-submit CSRF design that survives the iframe-proxy
boundary; middleware that enforces the token on every
non-idempotent BFF route; documentation of the contract for bot
services so their iframe POSTs include the token.
Out: per-request rotating tokens (one token per session is sufficient
and matches industry practice for double-submit).
Out: CSRF on routes that are explicitly intended to be invoked
without an authenticated session: `POST /api/auth/login`,
`POST /api/auth/register`, `GET /api/unsubscribe/:token`,
`POST /api/unsubscribe/:token` (the token *is* the auth).

## Design
Double-submit cookie pattern:
1. On session creation (security/01), mint a 32-byte random
   `csrf_token` and persist it on the `sessions` row.
2. Set a non-HttpOnly cookie `csrf-token=<hex>` on the same response
   so client-side JS can read it.
3. Require every state-changing route (`POST`, `PUT`, `PATCH`,
   `DELETE` — Nitro method check) to carry the same token in the
   `X-CSRF-Token` request header.
4. The middleware verifies that the header equals the value in
   `sessions.csrf_token` for the current session. Mismatch → 403.

## Concrete changes

### 1. Token issuance
Update the session driver from `security/01` to additionally write
`csrf_token` on insert, and to emit the cookie on every successful
authenticated response. The cookie attributes:
- `httpOnly: false` (must be readable by browser JS)
- `secure: true` (override only in non-prod)
- `sameSite: 'lax'`
- max-age: same as the session.

### 2. Middleware
New `server/middleware/csrf.ts`:
- Skip if `event.method` is `GET`/`HEAD`/`OPTIONS`.
- Skip explicit allowlist: `/api/auth/login`, `/api/auth/register`,
  `/api/unsubscribe/...`.
- Otherwise resolve the session (using `requireUserSession`
  equivalent that does NOT 401 — we want to fall through to the
  individual route's own auth check), and if a session exists,
  compare `event.headers['x-csrf-token']` against
  `sessions.csrf_token`.

### 3. Client-side token plumbing
- Add `services/frontend/app/composables/useCsrf.ts` that reads the
  `csrf-token` cookie at module load (use `useCookie`) and exposes
  a `csrfHeader()` helper returning `{ 'X-CSRF-Token': value }`.
- Update every `$fetch(..., { method: 'POST' | 'PATCH' | 'DELETE' })`
  call site in `app/` to pass `headers: csrfHeader()`. Audit:
  - `components/bots/BotConfigDialog.vue` (POST /api/bots, PATCH
    /api/bots/:id, DELETE /api/bots/:id).
  - `pages/bots/index.vue` (PATCH/DELETE on bots).
  - `pages/inbox.vue` (PATCH /api/notifications/:id/read,
    POST /api/notifications/read-all).
  - `pages/settings/security.vue` (POST /api/auth/password, DELETE
    /api/user).
  - `pages/settings/index.vue` (PATCH /api/user).
  - `pages/settings/notifications.vue` (PATCH /api/user/preferences
    — note this is on the chopping block per Group B, but keep
    CSRF for as long as the route exists).
  - `pages/unsubscribe/[token].vue` (POST is allowlisted, do not add
    header).

### 4. Iframe propagation (the bit the thesis specifically calls out)
The iframe is loaded same-origin via the reverse proxy, so it can
read the same `csrf-token` cookie. Document this on the platform
side — `services/frontend/server/utils/module-proxy.ts` needs to
**forward** the `X-CSRF-Token` header on incoming requests to the
bot service (currently it forwards everything except a small
denylist; verify the header is in scope — yes it is).

Then the bot services must re-check the token? No — the
authoritative check happens at the BFF middleware **before**
proxying. The BFF rejects bad tokens at the reverse-proxy boundary
so the bot service never sees them.

Add a unit test on `module-proxy.ts` that the CSRF middleware runs
**before** the proxy handler. In Nitro this is the file-ordering
question (`server/middleware/csrf.ts` runs before
`server/routes/modules/[bot_id]/[...path].ts`); confirm by reading
the Nitro middleware docs.

### 5. Bot service iframe configuration page
The configure-page HTML inside the bot containers (e.g.
`services/bot-bazos/src/templates/configure.html`) needs a tiny
patch: every `fetch('/modules/bot-bazos/configs/...', { method:
'POST', ... })` call reads the `csrf-token` cookie via plain JS and
adds `X-CSRF-Token`. The cookie is same-origin (BFF origin), so it
is readable from the iframe.

This is the "transparent forwarding" the thesis mentions — the
iframe sees the same cookie because we proxy under the BFF origin.

## Acceptance criteria
- A logged-in user can hit any state-changing endpoint with the
  correct header; mismatch returns 403.
- A POST without the header returns 403 (not 401 — the user IS
  authenticated, they just failed CSRF).
- The login/register/unsubscribe routes still work without a token.
- An iframe POST from inside the bot-served configure page reaches
  the bot through the proxy with the header set, and the BFF
  middleware accepts it.
- Killing the session cookie also invalidates the CSRF token (the
  middleware can't resolve the session row).

## Open questions
- **Token rotation on privilege change?** Standard practice is to
  rotate the CSRF token on login, logout, and password change.
  Implement: on each `setUserSession` call, mint a fresh
  `csrf_token` and re-issue the cookie. On `/api/auth/password`
  success, do the same.
