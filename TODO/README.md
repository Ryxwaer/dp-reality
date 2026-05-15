# Implementation backlog

Concrete tasks bringing the implementation in line with the thesis
(`/home/ryxwaer/Documents/projects/dp-doc/chapters/03-architecture-design.tex`
and `04-implementation.tex`). Every task in this tree is self-contained
and is intended to be executed by an autonomous coding agent without
further user input. Tasks that needed user decisions have already had
those decisions baked in.

## Subfolders

- `platform/` — small, foundational platform fixes (orphan sweep,
  distinct MongoDB credentials per service, iframe URL hardening).
- `bots/` — net-new bot service implementations.
- `analytics/` — FR-04-B global market metrics dashboard.
- `deployment/` — remaining K3s + Flux work (node placement +
  resources, Mongo replica set, multi-arch CI, HPA, CronJobs). The
  foundational deployment items — base manifests, NetworkPolicies,
  Flux CD + image automation, SOPS — are already implemented and
  their dedicated TODO files have been retired. Operational details
  live in `k3s/runbook.md`.

## Priority for thesis defence

Ordered by how visible the gap is to a defence panel. The first
group are explicit thesis claims that the deployed system currently
contradicts; they must close before defence or the thesis text must
be softened. The second group are functional requirements that the
thesis lists. The third group is defensibly deferrable.

### P0 — Explicit thesis claims that currently contradict the code

1. `platform/02-mongo-credential-separation.md` — §3.7.1 promises
   distinct Mongo credentials per service; today every service shares
   the root URI. This is the highest-stakes remaining gap because
   the trust-boundary argument in §3.7.1 hinges on it.

### P1 — Functional Requirements that don't currently work

2. `platform/01-expires-at-daily-sweep.md` — FR-02-B (bots expire
   after a TTL). The `expires_at` field is set and bumped on login,
   but no sweep flips status to `stopped`. Pairs with…
3. `deployment/09-cronjobs.md` — the K8s CronJob shell that calls
   the sweep entrypoint produced by `platform/01`.
4. `analytics/01-fr04b-price-evolution-dashboard.md` — FR-04-B.
   Substantial; can be defended as "designed but out of scope" but
   then the thesis must say so.

### P2 — Defensible deferrals (defence prep needed)

5. `bots/01-bot-bezrealitky.md` — third bot proves platform
   extensibility but two bots already demonstrate the contract.
6. `deployment/03-mongodb-replica-set.md` and
   `deployment/02-node-placement-and-resources.md` — both depend on
   the RPi5 joining the cluster. Can defend "phase-2 once the
   second node arrives", but then the thesis topology paragraph
   needs the same caveat.
7. `deployment/05-multi-arch-ci-pipeline.md` — frontend is `amd64`-
   only today (build time). Only matters once the RPi5 is in.
8. `deployment/06-hpa-bff.md` — Mongo-backed sessions are in place
   (see "Already shipped" below); this is now a small isolated
   change.
9. `platform/04-iframe-url-include-user-id.md` — security defence
   in depth; the iframe contract works without it.

## Conventions every task assumes

- Thesis is the source of truth (see `CLAUDE.md`). Anything that
  contradicts the thesis must be flagged in the task's "Open questions"
  block, not silently changed.
- No silent error swallowing. Failures must surface as logs or
  bubble out — the code already follows this and new code must too.
- Everything user-facing is English (existing rule).
- Comments explain non-obvious intent only, never narrate the change.
- MongoDB data may be dropped/migrated freely when a schema changes —
  flag it in the task but do not preserve legacy shape "just in case".
- The thesis path is `/home/ryxwaer/Documents/projects/dp-doc/`. Task
  files cite it by section number; reading the corresponding `.tex`
  before each task is mandatory.

## Already shipped (deleted from this tree)

The following work is in production and no longer carries a TODO file:

- K3s base manifests (`k3s/base/**`) — every long-running workload
  has a Deployment / StatefulSet, ConfigMap, Service / NetworkPolicy.
- NetworkPolicies + kube-router enforcement (`k3s/base/network
  policies/**`, runbook §2b).
- Flux CD + image automation (`flux/clusters/prod/**`,
  `flux/infra/prod/**`, CI `main-<sha8>-<epoch>` tagging).
- SOPS + age encrypted secrets in Git (`k3s/base/secrets/**`,
  `.sops.yaml`, `.github/workflows/secrets-lint.yml`).
- Path B: ingress-nginx + kube-prometheus-stack + Flagger Canary on
  the frontend (`flux/infra/prod/**`, `k3s/base/frontend/canary.yaml`).
- The two-hop external routing topology (NPM TLS → ingress-nginx),
  documented in `k3s/runbook.md` Phase B.
- **Mongo-backed sessions** (was `security/01`) — `nuxt-auth-utils`
  dropped; `server/utils/session.ts` writes the session payload to
  the new `sessions` collection (TTL index reaps expired rows) and
  the cookie carries only an opaque session id. The §3.7.3
  "horizontal BFF replication" claim is now true.
- **CSRF tokens on state-changing routes** (was `security/02`) —
  `server/middleware/csrf.ts` enforces a double-submit token on
  every non-safe method and on every iframe-proxied write. The
  bot iframes (`bot-bazos`, `bot-sreality`) read the `csrf-token`
  cookie and echo it in the `X-CSRF-Token` header, which is exactly
  the §3.7.3 "transparent forwarding" contract.
- **DOMPurify-equivalent sanitiser** (was `platform/03`) —
  `server/utils/sanitize-html.ts` now wraps `isomorphic-dompurify`
  with the documented whitelist; Vitest suite under
  `services/frontend/test/sanitize-html.test.ts` covers the
  regression cases the regex parser would have failed.
- **Tailscale-only exposure of internal services** — Tailscale
  Kubernetes operator deployed via Flux
  (`flux/infra/prod/tailscale-operator.yaml`); Grafana and Prometheus
  carry `tailscale.com/expose` annotations and are reachable at
  `http://grafana` / `http://prometheus` from any tailnet member,
  invisible to the public web. Realises the §3.7.3 "only the frontend
  is exposed externally" claim for the observability plane. Procedure
  to expose anything else: cf. `k3s/runbook.md` Phase C.
- **Centralised logs (Loki + Promtail)** — single-binary Loki with
  Promtail DaemonSet (`flux/infra/prod/loki.yaml`); Grafana's
  datasource sidecar picks up the Loki datasource ConfigMap
  automatically. From Grafana → Explore → Loki, the equivalent of
  `kubectl logs -f` across every pod is two clicks away. 7-day
  retention matches Prometheus' window so metric anomalies and log
  lines line up on the same timeline. Procedure + LogQL crib sheet:
  cf. `k3s/runbook.md` Phase D.
