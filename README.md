# dp-reality

Implementation companion to the master's thesis at BUT FIT. Architecture,
design decisions, module model, notification flow, and deployment
rationale live in the thesis (`dp-doc/chapters/`) — this README only
covers how to actually run the stack.

## Development

```bash
cp .env.example .env
docker compose -f compose.dev.yml up --build --watch
```

`compose.dev.yml` is a **standalone** dev stack — do not merge it with
`compose.yml`. It publishes service ports to the host, uses a local
bridge network (no `nginx-proxy-manager` needed locally), points the
mailer at the dev SMTP server, and enables `docker compose watch`
live-reload blocks. `compose.yml` is reserved for production.

The frontend is built from `services/frontend/Dockerfile.dev` (single
stage, runs `bun run dev` which boots `nuxt dev` with Vite HMR) so
edits under `services/frontend/` are synced into the container by
`--watch` and hot-reload in the browser — no rebuild needed.
`package.json` / `bun.lock` changes trigger a rebuild. The Python bots use `sync+restart` / `rebuild`
actions; see their `develop.watch` blocks for specifics.

- Dashboard: http://localhost:3000
- RabbitMQ management: http://localhost:15672

MongoDB is **not** spun up by the stack; point `MONGODB_URI` at an
external instance.

## Production deploy (K3s on Fedora CoreOS)

The production target per thesis §3.4–3.5 is a K3s cluster. Phase 1
ships a **single-node** install on `server.ryxwaer.com` that coexists
with the existing `nginx-proxy-manager` Docker stack on the same
host. NPM keeps owning TLS and reverse-proxies
`reality.ryxwaer.com` to a `NodePort` Service inside the cluster.

- Manifests: `k3s/base/` + `k3s/overlays/prod/`.
- Operator runbook: [`k3s/runbook.md`](k3s/runbook.md).
- Adding a new deployable service is a checklist of files to create
  + push (no manual `kubectl` step): see
  [Adding a new deployable service](k3s/runbook.md#adding-a-new-deployable-service)
  in the runbook.
- MongoDB lives inside the cluster as a single-member replica set
  (`dp-rs`); it is independent of any external Mongo the host may
  already run.
- NetworkPolicies enforce the inter-pod allow-list from thesis
  §3.7.1; they require `kube-router` (see runbook step 2) because
  K3s default Flannel does not enforce them.

The RPi5 second node, full Flux CD GitOps + multi-arch CI, SOPS for
secrets at rest, and the periodic CronJobs are deferred to phases 2
and 3 of the deployment migration (see
[`TODO/deployment/`](TODO/deployment/)).

### Legacy Portainer / `compose.yml` deploy

`compose.yml` is the previous production target (Portainer Stack on
Fedora CoreOS, NPM-proxied container DNS) and remains runnable; it
will be retired once the K3s deployment is verified. Until then both
stacks can coexist on the same host (the K3s frontend is on
NodePort 30080; the Docker frontend is reached by container DNS).
