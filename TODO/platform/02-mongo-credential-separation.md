# platform/02 — Distinct MongoDB credentials per service

## Goal
Enforce the trust boundary thesis §3.7.1 promises: the BFF and each
bot service must connect to MongoDB with **different** credentials so a
compromise of one workload cannot reach into another's private
collections.

## Thesis references
- `03-architecture-design.tex` §3.7.1 Network and Identity Boundaries:
  > "The BFF and bot services connect to MongoDB with distinct
  > credentials, so the trust boundary between them is enforced in
  > the data layer rather than at the application protocol […]"

## Current state
- Every service reads a single shared `MONGODB_URI` from env (see
  `compose.yml` lines 27, 57, 81, 105; equivalent dev file). The URI
  carries one set of credentials with implicit full-DB privileges.
- The data layer enforces no boundary today.

## Scope
In: define the per-role privilege matrix, document the required Mongo
users, plumb separate URIs through compose / dev compose / env-example,
and adjust each service to read its own URI variable.
Out: Atlas-specific role definitions (this stack uses a self-hosted /
external replica set). Out: writing the K3s Secret YAML — that is
already covered in `deployment/01-k3s-manifests.md`.
Out: data migration of existing documents (no schema changes here).

## Privilege matrix
Database: the single application DB (whatever `MONGODB_URI` currently
points at; call it `dp_reality` below).

| User                  | Collection access                                                                            |
|-----------------------|----------------------------------------------------------------------------------------------|
| `bff`                 | `users` rw, `notifications` r, `module_registry` r, `<bot>_config` (per row: `active` field + `deleteOne`; **no** read/write of `config` sub-document). Plus `sessions` rw (see security/01). |
| `bot-bazos`           | `listings_bazos` rw, `bazos_config` rw, `notifications` w (append-only via the unique index), `module_registry` rw (its own row). Read on `users` is **forbidden**. |
| `bot-sreality`        | `listings_sreality` rw, `sreality_config` rw, `notifications` w, `module_registry` rw (own row). |
| `bot-bezrealitky`     | Mirror of `bot-sreality` against its own collections (see `bots/01-bot-bezrealitky.md`). |
| `email-notifier`      | `users` r, `notifications` rw (only `sent_at` set; everything else read-only — enforced at app layer; Mongo role grants update on the collection but the code path only sets `sent_at`). |

The BFF's "deleteOne on the `config` sub-document" requirement is
expressed as a custom role granting `find` + `update`/`remove` on the
collection. The "no read of `config` sub-document" rule cannot be
fully enforced inside Mongo's role model (Mongo's field-level
redaction requires Atlas-only features) — instead, document that the
BFF code MUST NOT project `config` from any `<bot>_config` collection,
and add an ESLint-style guard test (a unit test that grep-scans
`services/frontend/server/**` for `<bot>_config` reads with `config`
in the projection list).

## Concrete changes

### 1. Environment plumbing
Replace the single `MONGODB_URI` with:
- `MONGODB_URI_BFF` — read by the frontend container.
- `MONGODB_URI_BOT_BAZOS` — read by `bot-bazos`.
- `MONGODB_URI_BOT_SREALITY` — read by `bot-sreality`.
- `MONGODB_URI_BOT_BEZREALITKY` — read by `bot-bezrealitky` (when that
  service exists).
- `MONGODB_URI_EMAIL_NOTIFIER` — read by `email-notifier`.

Update:
- `compose.yml` and `compose.dev.yml`.
- `.env.example` — add all five with stub values + a leading comment
  explaining the per-role split.
- `services/frontend/nuxt.config.ts` runtimeConfig: rename `mongodbUri`
  to `mongodbUri` still (same key) but its env name is now
  `NUXT_MONGODB_URI_BFF`.
- `services/bot-bazos/src/config.py` and
  `services/bot-sreality/src/config.ts`: read their dedicated env var,
  fall back to `MONGODB_URI` only with a deprecation warning so a
  half-rolled-out compose stack still boots in dev.
- `services/email-notifier/internal/config/config.go`: same pattern.

### 2. Mongo user provisioning helper
Add `scripts/provision-mongo-users.mjs`. Takes `MONGODB_URI_ADMIN`
(superuser) from env, idempotently creates the five users above with
the privilege matrix, and exits. Document that this is a one-shot
operator script — it is NOT part of any container's startup, because
no service in the stack should ever hold credentials capable of
creating users.

The script must use custom roles (created via `db.createRole`) for the
BFF case (find + update/remove on `<bot>_config`), since the
BFF's restricted access cannot be expressed with the built-in roles.

### 3. Code guard
Add a unit test under `services/frontend/test/projection-guard.test.ts`
(create the test scaffolding if it doesn't exist — minimal, just
enough to run `vitest`). The test reads every `.ts` under
`server/utils/`, `server/api/`, `server/tasks/`, `server/plugins/` and
asserts that no MongoDB `find*` / `aggregate` call references a
`<bot>_config` collection with a projection that includes `config`.

## Acceptance criteria
- Each of the 5 service containers boots with its own URI; pulling
  the wrong URI (e.g. BFF → bot-bazos credential) fails the boot
  loudly with the Mongo auth error.
- `scripts/provision-mongo-users.mjs` is idempotent.
- The projection-guard test passes on the current codebase.
- BFF code paths that previously read `<bot>_config.config` (only
  `proxyToModule` indirectly — verify) are unaffected because the
  BFF no longer needs to read the inner config; the iframe talks to
  the bot's own HTTP API instead.

## Open questions
- **Who runs `provision-mongo-users.mjs`?** Documented as an
  operator-run script. In K3s this could become a one-shot Job that
  runs once per cluster bootstrap and is then deleted; see
  `deployment/01-k3s-manifests.md`.
- **External Mongo readiness.** The thesis (§3.4 Replication) targets
  a 2-node replica set. This task does not depend on that being live;
  the credential split works on any single mongod. The K3s task will
  layer the replica set on top.
