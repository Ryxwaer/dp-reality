# platform/01 — Daily expiration sweep for `users.bots[].expires_at`

## Goal
Make FR-02-B (visit-to-refresh engagement) actually engage by adding the
daily sweep that transitions stale `active` bot rows to `stopped` when
their `expires_at` is in the past.

## Thesis references
- `03-architecture-design.tex` §3.4 Database Design — `users` collection,
  `expires_at` semantics on `users.bots[]` (≈ line 484).
- `03-architecture-design.tex` end of §3.2.2 / start of §3.3 — FR-02-B
  visit-to-refresh wording (≈ line 597).
- Pre-existing scope note: `/home/ryxwaer/Documents/projects/dp-doc/TODO.md`
  item 2.

## Current state
- `services/frontend/server/utils/bot-expiry.ts` defines
  `BOT_EXPIRES_TTL_MS` (30 days), `nextBotExpiry()`, and `bumpExpiresAt()`.
- `bumpExpiresAt()` is called from `api/auth/login.post.ts` (every login).
- `api/bots/[id].patch.ts` stamps `expires_at` when a bot transitions
  into `active` from `pending` or `stopped`.
- There is **no periodic check** that flips stale `active` rows past
  `expires_at` to `stopped`. So FR-02-B has the field but no actor.

## Scope
In: add the daily sweep, plumbed in two places (K3s CronJob for prod,
Nitro scheduled task for the dev compose stack — see notes below).
Out: changing `BOT_EXPIRES_TTL_MS`, changing the field shape, changing
the bump semantics on login. Out: writing the K3s CronJob YAML — that
lives under `deployment/09-cronjobs.md`. This task only produces the
binary that the CronJob will exec.

## Concrete changes

### 1. New shared sweep routine
Add `services/frontend/server/utils/bot-sweep.ts` exposing
`sweepExpiredBots(db)` — pure function so both the Nitro scheduled task
and the K3s one-shot job call the same code.

Behaviour, in one pass:
1. Project every user whose `bots[]` has at least one entry with
   `status:'active'` and `expires_at <= now`.
2. For each such entry:
   1. Resolve `bot_id → config_collection` via the `module_registry`
      lookup that `tasks/janitor/provisional-bots.ts` already does
      (extract that into `registry.ts` if cleaner).
   2. Flip `<bot>_config.active = false` for the matching `_id`
      (BFF-owned lifecycle write, exactly as in the existing pause
      flow — see `api/bots/[id].patch.ts`).
   3. Then `$set bots.$[bot].status = 'stopped'` on the user document
      (arrayFilters on `config_id`).
3. Return `{ swept: N, ts }` for logging.

Order matters — bot-side row first, BFF cache second, same rationale
as the existing pause path.

### 2. Wire into the Nitro scheduler
`services/frontend/nuxt.config.ts` already has
`nitro.scheduledTasks`. Add a daily entry (`0 3 * * *`) that runs a
new task file at `server/tasks/sweep/expired-bots.ts`. That task is a
thin wrapper that calls `sweepExpiredBots(db)`.

### 3. Standalone CronJob entrypoint
Write `scripts/sweep-expired-bots.mjs` that connects to Mongo and
calls the same logic. It must:
- Read `MONGODB_URI` (or `NUXT_MONGODB_URI`) from env.
- Exit non-zero on any unhandled error (fail-fast).
- Log a summary line in JSON `{swept, ts}` to stdout.

This is the binary the K3s CronJob will invoke — bundled in the
frontend image so it has access to the same registry / collections
without a new image. The K3s manifest will use:
`command: ["node", "scripts/sweep-expired-bots.mjs"]`.

## Acceptance criteria
- A user document with a `bots[]` entry where `status='active'` and
  `expires_at < now` is transitioned to `stopped` on the next sweep run.
- The corresponding `<bot>_config.active` is set to `false` before
  the user document is updated.
- `pending`, `stopped`, and `deleted` rows are untouched.
- Rows with `expires_at = null` are untouched.
- Running `node scripts/sweep-expired-bots.mjs` from outside the
  Nitro server completes and prints the JSON summary.
- The new Nitro scheduled task does not run on every dev rebuild — the
  cron expression is honoured.

## Open questions
None. The thesis is unambiguous here.
