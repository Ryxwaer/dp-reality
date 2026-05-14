# deployment/00 — Overview & target topology

This is the index for the K3s migration. The deployment tasks
01–09 collectively realise the topology described in thesis §3.4
(Deployment and Scaling Strategy) and §3.5 (Infrastructure Design).

## Target topology (from thesis §3.5.1)

- **Primary node (x86_64)**: Minisforum X1 AI (AMD Ryzen 7), Slovakia.
  Hosts: control plane, MongoDB primary, RabbitMQ, BFF, heavier bot
  services (bot-sreality, bot-bezrealitky), email-notifier
  (acceptable either node), CronJobs (sweep, provisional janitor).
- **Worker node (ARM64)**: Raspberry Pi 5, Czechia. Hosts: lightweight
  bot services (bot-bazos), MongoDB secondary.
- **Cross-node VPN**: Tailscale mesh integrated at the K3s level
  (the existing `k3s/server.yaml` and `k3s/worker.yaml` already
  carry the `vpn-auth` directive — keep this pattern).

## Deployment task list

| # | Task                                          | Depends on |
|---|-----------------------------------------------|------------|
| 01 | `k3s-manifests.md` — core Deployments, Services, ConfigMaps, Secrets, Ingress | — |
| 02 | `node-placement-and-resources.md` — taints, tolerations, affinity, requests/limits, QoS | 01 |
| 03 | `mongodb-replica-set.md` — two-node MongoDB replica set across the Tailscale link | 01, 02 |
| 04 | `network-policies.md` — pod-to-pod allow-list per §3.7.1 | 01, 02 |
| 05 | `multi-arch-ci-pipeline.md` — buildx-based CI for amd64+arm64 images | — (can parallel) |
| 06 | `hpa-bff.md` — HorizontalPodAutoscaler on the BFF | 01, 02, security/01 (sessions in Mongo) |
| 07 | `flux-cd-gitops.md` — Flux CD installation + Kustomizations | 01–06 in place |
| 08 | `sealed-secrets-or-sops.md` — encrypted secrets-at-rest in Git | 07 |
| 09 | `cronjobs.md` — the daily sweep (platform/01) and provisional-janitor as actual CronJobs | 01 (+ platform/01) |

Tasks may be implemented in numeric order. Cross-task dependencies are
called out explicitly in each file's header.

## Stack-wide conventions for the K3s manifests

- One Kustomization per concern; the structure under `k3s/` becomes:
  ```
  k3s/
    base/
      namespace.yaml
      configmaps/
      secrets/                  # placeholders only — real secrets via SealedSecrets
      rabbitmq/
      mongodb/
      bot-bazos/
      bot-sreality/
      bot-bezrealitky/
      email-notifier/
      frontend/
      ingress/
      networkpolicies/
      hpa/
      cronjobs/
    overlays/
      prod/
        kustomization.yaml      # picks base + sets image tags, replica counts, etc.
  ```
- Namespace: `dp-reality`. Everything goes in there.
- Labels every resource carries:
  ```
  app.kubernetes.io/part-of: dp-reality
  app.kubernetes.io/component: <bot|bff|notifier|broker|db|ingress|policy>
  app.kubernetes.io/name: <service-name>
  ```
- Container images come from a GHCR registry namespace
  `ghcr.io/<owner>/dp-reality/<service>:<tag>`. The CI in task 05
  publishes them.
- Secret material is referenced by name from a `Secret` resource; the
  actual encrypted-at-rest material is delivered via task 08
  (SealedSecrets/SOPS). Tasks 01–06 may commit `Secret` manifests with
  placeholder values; task 08 wires them up.

## Cluster-bootstrap order at deploy time (informational)

1. K3s installed on Minisforum (already documented in
   `k3s/k3s_setup.md`).
2. K3s agent installed on RPi5 (likewise).
3. Tailscale already joining both nodes.
4. Flux CD installed pointing at the Git repo (task 07).
5. Flux reconciles the `base/` manifests; the cluster comes up.
6. Operator runs `scripts/provision-mongo-users.mjs` once against the
   newly-created replica set (task 03 produces the replica set; the
   provisioning script was added in `platform/02`).
