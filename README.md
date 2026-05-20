# dp-reality

https://github.com/Ryxwaer/dp-reality.git

Implementation part of my master's thesis at BUT FIT. This README only
covers how to run the stack — everything else lives in the thesis text.

## Prerequisites

- Docker Engine 24+ with the Compose v2 plugin (`docker compose` command,
  with `develop.watch` support)
- ~4 GB of free RAM and ports `3000`, `5672`, `15672`, `3200`, `4317`,
  `4318`, `8001`, `8002`, `8003` free on the host

That's it. No Node, Bun, Python, Go or MongoDB needed on the host —
everything runs inside containers.

## Run

```bash
docker compose up --build --watch
```

The compose file is self-contained: it spins up MongoDB, RabbitMQ,
Grafana Tempo, all three scraping bots, the email notifier, and the
Nuxt frontend. First boot builds the service images (a few minutes);
subsequent runs are fast. `--watch` enables live reload of Python/TS
sources via `docker compose watch`.

Open the dashboard at <http://localhost:3000> and register a new
account on `/register`. The bots immediately start scraping in the
background; once they finish their first cycle (a couple of minutes),
listings start landing in the inbox.

| Service               | URL                            |
| --------------------- | ------------------------------ |
| Frontend              | http://localhost:3000          |
| RabbitMQ management   | http://localhost:15672 (`guest` / `guest`) |
| Tempo (OTLP traces)   | http://localhost:3200          |

## Configuration

All configuration has working defaults baked into `compose.yml`. To
override anything (SMTP credentials for outbound email, custom MongoDB
URI, custom RabbitMQ credentials, …) copy `.env.example` to `.env` and
edit the values you care about — see the comments in that file.

## Teardown

```bash
docker compose down -v
```

`-v` removes the MongoDB / RabbitMQ / Tempo volumes too, giving you a
clean slate for the next run.

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
