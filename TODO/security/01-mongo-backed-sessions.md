# security/01 — Move session state from encrypted cookies into MongoDB

## Goal
Make thesis §3.7.3 true: session state must live in MongoDB so the
BFF can be horizontally replicated (HPA target in thesis §3.4
"Autoscaling"). Today `nuxt-auth-utils` stores the entire session
payload inside the cookie, which means two BFF replicas would each
see the same encrypted blob but would not share session lifecycle
(invalidation, rotation, server-side logout).

## Thesis references
- `03-architecture-design.tex` §3.7.3 Authentication and Session
  Management:
  > "session tokens are cryptographically random and stored in
  > HTTP-only secure cookies with the session state persisted in
  > MongoDB (allowing horizontal BFF replication)"
- `03-architecture-design.tex` §3.4 "Autoscaling" — HPA on the BFF
  presupposes shared session state.

## Current state
- `services/frontend/nuxt.config.ts` lists `nuxt-auth-utils` as a
  module.
- `services/frontend/server/api/auth/register.post.ts` and
  `login.post.ts` call `setUserSession(event, {...})`.
- `services/frontend/server/utils/auth.ts` calls
  `requireUserSession(event)` everywhere.
- `nuxt-auth-utils` default backing store is an encrypted cookie keyed
  by `NUXT_SESSION_PASSWORD`. There is no `sessions` collection in
  MongoDB.

## Scope
In: replace the cookie-backed session payload with a Mongo-backed
session keyed by an opaque cookie-resident `session_id`. Keep
`nuxt-auth-utils` as the API surface (do not rewrite every
`requireUserSession` call site) by configuring it with a custom
storage driver, OR replace it outright with a thin custom session
middleware — whichever is less invasive. Out: SSO / OAuth2 / refresh
token machinery. Out: changing the session lifetime semantics.

## Concrete changes

### 1. New `sessions` collection
Document shape:
```
{
  _id: ObjectId            // session id; the cookie carries its hex
  user_id: ObjectId        // reference into `users`
  created_at: Date
  last_seen: Date
  expires_at: Date         // absolute expiry (idle-extend on each request)
  user_agent: string       // for diagnostics + suspicious-activity surfacing
  ip: string               // first IP only; not updated on every hit
}
```

Indexes (created in `server/plugins/indexes.ts`):
- `{ user_id: 1 }` — non-unique, supports "log out all my sessions"
  later.
- `{ expires_at: 1 }` with `expireAfterSeconds: 0` — TTL index so
  expired sessions are reaped by Mongo without app code.

Add `sessions` to the `COLLECTIONS` const in
`server/utils/db.ts`.

### 2. Session driver
Two acceptable shapes — pick (a) and only fall back to (b) if (a)
turns out to be impossible with the current `nuxt-auth-utils` version:

(a) `nuxt-auth-utils` custom storage adapter.
Implement a Nitro storage driver that reads/writes the session JSON
from the `sessions` collection (use `unstorage`'s `defineDriver`
signature). Configure it in `nuxt.config.ts` via the official
`nuxt-auth-utils` `sessionConfig.storage` option. The cookie still
exists but only carries the `_id`; the payload is server-side.

(b) Replace the module.
Drop `nuxt-auth-utils` and write a tiny middleware that:
1. Generates the cookie on `setUserSession`-equivalent calls.
2. Looks up the session on every request in a Nitro middleware.
3. Exposes `requireUserSession` / `setUserSession` / `clearUserSession`
   from `server/utils/session.ts` with the same signatures so
   existing call sites compile unchanged.

Either way, the cookie attributes MUST be:
- `httpOnly: true`
- `secure: true` (override to `false` only when
  `NODE_ENV !== 'production'`)
- `sameSite: 'lax'` (kept compatible with the unsubscribe link flow
  which is a same-site GET).
- 30-day max-age, refreshed on each authenticated request via
  `last_seen` + new `expires_at` write.

### 3. Logout + invalidate
`/api/auth/logout.post.ts` must `deleteOne` the session row before
clearing the cookie. Add `DELETE /api/auth/sessions` (no body) that
deletes every session for the current user (used in the "delete
account" path so a half-deleted account cannot continue serving an
existing logged-in tab).

### 4. Bcrypt hardening side-fix
`register.post.ts` and `password.post.ts` use `hash(pw, 12)`. Keep
12. Mention in the task that 12 is appropriate for the deployment
hardware (ARM64 RPi5 included) and matches §3.7.3 "cost factor
appropriate to the deployment hardware".

### 5. Migration
Existing users have no sessions to migrate (cookies stop working
naturally — the new code does not understand the old encrypted
payload). Users will be logged out once. Document this in the
task's PR description; no schema change to `users`.

## Acceptance criteria
- A login round-trip leaves exactly one row in `sessions` with the
  expected shape.
- Killing the row out-of-band causes the next authenticated request
  to 401.
- Two BFF replicas (simulated locally with two `nuxt dev`
  invocations against the same Mongo) can each handle requests
  carrying the same session cookie — the second replica sees the
  session because it reads Mongo, not the cookie payload.
- Logout deletes the row.
- `expires_at` TTL index reaps idle sessions after the configured
  duration (verify by setting `expires_at` to a past value and
  observing the row disappear within Mongo's 60s TTL sweep window).

## Open questions
- **`nuxt-auth-utils` adapter API stability.** If the module's
  storage interface changes between minor versions, the adapter
  becomes a maintenance burden. Bias toward option (b) — a 100-line
  custom middleware that we control — if option (a) requires
  monkey-patching internal types.
