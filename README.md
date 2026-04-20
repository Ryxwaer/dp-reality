# dp-reality

Web content aggregation platform for Czech real estate listings.
Built as a microservices architecture for a Master's thesis at BUT FIT.

## Architecture

```
services/
  modules/           # Always-on gRPC BotModule servers (K8s Deployments)
    bazos/           # Python — Bazos.cz module definition & config API
    sreality/        # NestJS (TypeScript) — Sreality.cz module definition & config API
  jobs/              # Scraper jobs (scheduler in Phase 1, K8s CronJobs in Phase 2)
    bazos/           # Python — Bazos.cz HTML scraper
    sreality/        # NestJS (TypeScript) — Sreality.cz API scraper
  notification/      # Go — email notification consumer
  frontend/          # Nuxt 4 (TypeScript) — dashboard & BFF layer
proto/               # Shared Protocol Buffer definitions (BotModule gRPC contract)
```

## Technology Stack

| Component          | Technology                |
|--------------------|---------------------------|
| Frontend           | Nuxt 4 (Vue.js, TypeScript) |
| Sreality scraper   | NestJS (TypeScript)       |
| Bazos scraper      | Python (httpx, BeautifulSoup) |
| Notification       | Go                        |
| Database           | MongoDB                   |
| Message broker     | RabbitMQ                  |
| Inter-service RPC  | gRPC (Protocol Buffers)   |
| Orchestration      | K3s (Phase 2+)            |

## Communication Patterns

- **Synchronous**: Frontend ↔ MongoDB (user data, listings, bot configs)
- **Asynchronous**: Scrapers → RabbitMQ (`scrape.completed`) → Notification Service
- **gRPC**: Frontend BFF ↔ Bot Modules (ParseUrl, GetConfigSchema, GetOverview)

## Module Architecture

Each scraper source is split into two containers:

- **Module** (`services/modules/<source>/`): Always-on gRPC server implementing the
  `BotModule` service. Handles URL parsing, config schema, and overview queries.
  Self-registers in MongoDB `modules` collection at startup.
- **Job** (`services/jobs/<source>/`): Scraper logic that fetches listings, persists to
  MongoDB, and publishes `scrape.completed` events to RabbitMQ. Runs on a scheduler
  in Phase 1; becomes a Kubernetes CronJob in Phase 2.

Adding a new source requires deploying one module and one job container —
no changes to the frontend or any other service.

## Frontend (`services/frontend/`)

Nuxt 4 dashboard built on top of [Nuxt UI 4](https://ui4.nuxt.com/) with a
Backend-for-Frontend layer (server routes under `server/api/`) that talks
directly to MongoDB.

- **Auth**: email/password with bcrypt hashing, session cookies via
  [`nuxt-auth-utils`](https://github.com/Atinux/nuxt-auth-utils). Signing
  secret comes from `NUXT_SESSION_PASSWORD`.
- **Inbox**: each matched listing is stored as one row in the `notifications`
  MongoDB collection and rendered per-listing in the UI with an unread flag.
- **Bots**: the `/bots` page lists the user's `bots[]` entries. Each bot is
  tied to a module via `module_id` and carries an opaque `config` object whose
  shape is owned by that module. Editing a bot re-mounts the module's own UI
  prefilled with the current config.
- **Modules (POC)**: a module is a single ES module bundle (`.mjs`) that
  exports a Vue component factory. Modules are stored in MongoDB (in the
  `modules` collection) and dynamically `import()`ed in the browser via a Blob
  URL when a user opens `/modules/:id/new` or `/bots/:id/edit`. The app hands
  Vue primitives (`h`, `ref`, `reactive`, `computed`, `watch`, `onMounted`) and
  a `saveBot(payload)` helper to the factory through a host object — module
  bundles do **not** import Vue themselves, which keeps exactly one Vue
  instance in the page. See [`services/module-sdk/`](services/module-sdk/) for
  the authoring scaffold and template.

Generate a session secret with `openssl rand -hex 32` and drop it into
`NUXT_SESSION_PASSWORD`.

### Modules trust model (POC)

The module system is intentionally simple for the thesis' proof-of-concept
stage:

- **Any authenticated user can upload any JavaScript** through
  `/modules/upload`. That code is stored verbatim in MongoDB.
- When a user opens a module-driven page, the bundle runs in their browser
  with full access to their session. Only upload modules you have reviewed.
- Module code is **never executed server-side** in this iteration, which
  bounds the blast radius of a malicious upload.
- The BFF validates the bundle size (≤ 1 MB) and serves it with a locked-down
  `Content-Type: application/javascript` + `Cache-Control: must-revalidate`.

Planned follow-ups (explicitly out of scope for the POC): admin-only upload,
signed bundles, iframe sandbox with a `postMessage`-based host API, and
optional server-side hooks running under a real VM (e.g. `isolated-vm`).

### Notification flow

Two RabbitMQ fanout exchanges drive email delivery:

- `scrape.completed` — published by each scraper job after a run. The Go
  notifier fetches new listings since each user's `last_notified_at`,
  matches them against every active bot, sends a consolidated email, and
  writes one `notifications` row per matched listing so the inbox UI can
  render them.
- `bot.created` — published by the frontend BFF when a user saves a new
  bot. The notifier replies with a one-off "bot activated" digest
  containing matches from the last 24 h (or a short welcome email if the
  window is empty). Inbox rows are deduped via a unique
  `(user_id, source, source_id)` index so the regular flow can't re-email
  the same listings.

## Development

```bash
cp .env.example .env    # configure MongoDB URI, RabbitMQ, SMTP, session secret
docker compose up --build
```

- Dashboard: http://localhost:3000
- RabbitMQ management: http://localhost:15672

## Deployment Phases

1. **Phase 1 — Alpha**: Single-node Docker Compose, standalone MongoDB, scheduler-based scrapers
2. **Phase 2 — Release**: K3s cluster, MongoDB ReplicaSet, CronJob scrapers with topology spread
3. **Phase 3 — Production**: Multi-node edge deployment, MongoDB Atlas, KEDA autoscaling

## Related Repositories

- [bazos_watcher](https://github.com/Ryxwaer/bazos_watcher) (private) — original Bazos PoC
- [reality_bot](https://github.com/Ryxwaer/reality_bot) (private) — original Sreality PoC
