# dp-reality

Implementation part of my master's thesis at BUT FIT. This README only
covers how to run the stack - everything else lives in the thesis.

## Development

```bash
cp .env.example .env
docker compose -f compose.dev.yml up --build --watch
```

`compose.dev.yml` is the standalone dev stack: it publishes service ports
to the host, uses a local bridge network, points the mailer at a dev SMTP
server, and enables live-reload via `docker compose watch`. `compose.yml`
is the production target.

The frontend runs from `services/frontend/Dockerfile.dev` (Nuxt dev server
with Vite HMR), so edits under `services/frontend/` hot-reload in the
browser. Python bots use `sync+restart` / `rebuild` watch actions, see
each `develop.watch` block.

- Dashboard: http://localhost:3000
- RabbitMQ management: http://localhost:15672

MongoDB is not spun up by the stack, point `MONGODB_URI` at an external
instance.

## Production deploy (K3s on Fedora CoreOS)

Single-node K3s install on `server.ryxwaer.com` that coexists with the
existing `nginx-proxy-manager` Docker stack on the same host. NPM owns
TLS and reverse-proxies `reality.ryxwaer.com` to a `NodePort` Service
inside the cluster.

- Manifests: `k3s/base/` + `k3s/overlays/prod/`
- Operator runbook: [`k3s/runbook.md`](k3s/runbook.md)
- Adding a new deployable service: see [the runbook](k3s/runbook.md#adding-a-new-deployable-service)
- MongoDB lives inside the cluster as a single-member replica set (`dp-rs`)
- NetworkPolicies enforce inter-pod allow-list, they require `kube-router`
  (K3s default Flannel does not enforce them)

RPi5 second node, full Flux CD GitOps with multi-arch CI, SOPS for
secrets at rest and periodic CronJobs are deferred to later phases
(see [`TODO/deployment/`](TODO/deployment/)).

### Legacy Portainer / `compose.yml` deploy

`compose.yml` is the previous production target (Portainer Stack on
Fedora CoreOS, NPM-proxied container DNS) and stays runnable until
the K3s deployment is verified. Both stacks can coexist on the same
host (K3s frontend on NodePort 30080, Docker frontend reached by
container DNS).
