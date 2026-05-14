# deployment/04 — NetworkPolicies

## Goal
Enforce the pod-to-pod allow-list described in thesis §3.7.1: the BFF
talks to every bot + Mongo + RabbitMQ; bot services talk to Mongo and
RabbitMQ only; the email-notifier talks to Mongo, RabbitMQ, and the
external SMTP provider; nothing else.

## Thesis references
- `03-architecture-design.tex` §3.7.1 Network and Identity Boundaries:
  > "Inside the cluster, NetworkPolicy resources restrict pod-to-pod
  > traffic to the service-graph paths described in
  > Section §3.6: the BFF reaches every bot service (for the
  > reverse-proxy traffic) and the message infrastructure; bot
  > services reach MongoDB and RabbitMQ only; the email notifier
  > reaches MongoDB, RabbitMQ, and the external SMTP provider. The
  > BFF is the only workload carrying an Ingress definition with TLS
  > termination, and per-pod egress is denied by default outside the
  > allow list each service declares."

## Current state
- No NetworkPolicies.
- K3s ships with Flannel; NetworkPolicy enforcement requires a
  network plugin that honours them. **K3s default Flannel does NOT
  enforce NetworkPolicies.** Either install a separate
  NetworkPolicy controller (kube-router) or enable Calico in K3s.

## Scope
In: write the NetworkPolicies and document the prerequisite that the
cluster runs a CNI that enforces them. Out: actually swapping the CNI
(operator runbook task; defer to the k3s_setup.md doc update).

## Pre-requisite (documented in `k3s/runbook.md` extension)
Either:
- Install K3s with `--flannel-backend=none --disable-network-policy=false`
  and install Calico afterwards, or
- Install the `kube-router` NetworkPolicy add-on on top of default
  Flannel (lighter-weight option for ARM64).

Pick the second (kube-router) by default — the RPi5 can't afford
Calico's overhead. Document both.

## Concrete changes

### Directory
`k3s/base/networkpolicies/`:
- `default-deny.yaml`
- `bff.yaml`
- `bot-services.yaml`
- `email-notifier.yaml`
- `rabbitmq.yaml`
- `mongodb.yaml`

### Manifests

**default-deny** (drop all ingress + egress unless explicitly allowed):
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: dp-reality
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**bff** (frontend):
- Ingress: from anywhere in the cluster on port 3000 (only the
  Ingress controller actually hits it). Plus inbound from the
  ingress-controller namespace (label-select Traefik's namespace).
- Egress: to `bot-bazos`, `bot-sreality`, `bot-bezrealitky`,
  `rabbitmq`, `mongodb-primary`, `mongodb-secondary`, and DNS
  (kube-system :53/UDP/TCP).

**bot-services** (one policy per bot, identical except for the
podSelector):
- Ingress: from `frontend` on port 8000 only.
- Egress: to `rabbitmq`, `mongodb-primary`, `mongodb-secondary`,
  DNS, and the external portal on 443.

The external portal allowlist needs an explicit egress CIDR per
bot. Default to `0.0.0.0/0` on 443 since the bot scrapes a single
target portal but DNS resolution is not stable. Document the
trade-off: full-egress-on-443 is the same posture as the existing
firewall and matches what the thesis allows (it does not pin per-bot
egress to a CIDR, only to a port and a logical target).

**email-notifier**:
- Ingress: none (it's a consumer, no inbound traffic except probe
  traffic from kubelet which K3s allows via host-network exemption).
- Egress: `rabbitmq`, `mongodb-primary`, `mongodb-secondary`, DNS,
  and the external SMTP server on 587.

**rabbitmq**:
- Ingress: from `frontend`, `bot-bazos`, `bot-sreality`,
  `bot-bezrealitky`, `email-notifier` on 5672.
- Ingress: from `frontend` on 15672 (management — optional).
- Egress: only DNS + intra-cluster gossip (none needed for a
  single-replica RabbitMQ).

**mongodb**:
- Ingress: from `frontend`, every bot, `email-notifier`, and from
  the OTHER Mongo pod on 27017 (for replica-set replication).
- Egress: DNS + replica-set traffic to the OTHER Mongo pod.

### Label requirements
Every workload's pod template must already carry
`app.kubernetes.io/name: <service>` (task 01 promised this). The
NetworkPolicies use that label as the `podSelector`.

### Cross-pod replica-set traffic
The Mongo NP allows ingress from any pod with label
`app.kubernetes.io/name in (mongodb-primary, mongodb-secondary)`.
Tasks 03 already produces those.

## Acceptance criteria
- `kubectl exec frontend-<hash> -- nc -zv mongodb-primary 27017`
  succeeds.
- `kubectl exec frontend-<hash> -- nc -zv 1.1.1.1 80` FAILS (BFF has
  no egress to internet HTTP).
- `kubectl exec bot-bazos-<hash> -- nc -zv frontend 3000` FAILS.
- `kubectl exec bot-bazos-<hash> -- nc -zv reality.bazos.cz 443`
  succeeds.
- Pre-requisite documented: the policies have no effect without
  kube-router (or Calico). The runbook prints a warning to that
  effect when applied to a cluster with default Flannel.

## Open questions
- **External-portal CIDR vs port-only.** The thesis is OK with a
  port-only allow-list; this task implements that. If at any point
  the operator wants tighter (per-portal IP allow-list), that's a
  later iteration — flag in the PR.
- **kube-router vs Calico.** Default to kube-router; revisit if RPi5
  CPU budget allows Calico.
