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

## Development

```bash
cp .env.example .env    # configure MongoDB URI, RabbitMQ, SMTP
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
