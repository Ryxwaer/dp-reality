# deployment/02 — Node placement (affinity / taints / tolerations) + resource requests/limits + QoS

## Goal
Distribute workloads across the two heterogeneous nodes exactly as
thesis §3.4 prescribes, and give every pod the resource requests +
limits that match its QoS class (Guaranteed for stateful, Burstable
for bot services).

## Thesis references
- `03-architecture-design.tex` §3.4 "Pod Distribution Strategy"
- `03-architecture-design.tex` §3.4 "Resource Allocation"
- `03-architecture-design.tex` §3.4 "Quality of Service classes"

## Current state
- Manifests from task 01 have no `nodeAffinity`, no `tolerations`,
  no `resources` block.

## Scope
In: labels on nodes, taints on the RPi5, affinity rules per workload,
tolerations on the RPi5-eligible workloads, requests/limits per
container. Out: actually applying labels to nodes — document the
kubectl commands but do not execute (cluster mutation is a deploy-time
operator action).

## Node labels & taints (operator runbook)
Add to a `k3s/runbook.md` (new file) the kubectl commands the
operator runs once after the cluster is up:
```
# Label both nodes by architecture and location for readability.
kubectl label node minisforum kubernetes.io/arch=amd64 dp-reality/location=sk
kubectl label node rpi5       kubernetes.io/arch=arm64 dp-reality/location=cz

# Taint the RPi5 so only explicitly-tolerating pods land there.
kubectl taint node rpi5 dp-reality/edge=true:NoSchedule
```

(The K3s installer sets `kubernetes.io/arch` automatically; the
command is for explicitness if a node is mis-labelled.)

## Affinity matrix

| Workload                | Hard affinity            | Soft preference          | Tolerations               |
|-------------------------|--------------------------|--------------------------|----------------------------|
| `mongodb-primary`       | `kubernetes.io/arch=amd64` | —                       | —                          |
| `mongodb-secondary`     | `kubernetes.io/arch=arm64` | —                       | `dp-reality/edge=true:NoSchedule` |
| `rabbitmq`              | `kubernetes.io/arch=amd64` | —                       | —                          |
| `frontend`              | `kubernetes.io/arch=amd64` | —                       | —                          |
| `email-notifier`        | —                        | `arch=arm64` (preferred)  | `dp-reality/edge=true:NoSchedule` |
| `bot-bazos`             | —                        | `arch=arm64` (preferred)  | `dp-reality/edge=true:NoSchedule` |
| `bot-sreality`          | `kubernetes.io/arch=amd64` | —                       | —                          |
| `bot-bezrealitky`       | `kubernetes.io/arch=amd64` | —                       | —                          |
| CronJobs                | `kubernetes.io/arch=amd64` | —                       | —                          |

Rationale per the thesis:
- Mongo, RabbitMQ, BFF are stateful or I/O intensive → Minisforum.
- Heavier bots (Sreality JSON API + Bezrealitky hybrid + header
  rotation) pinned to Minisforum.
- Bazos is the lightest scraper → preferred RPi5 to demonstrate the
  heterogeneity story.

Affinity is expressed as `requiredDuringSchedulingIgnoredDuringExecution`
for hard pins and `preferredDuringSchedulingIgnoredDuringExecution`
(weight 50) for soft.

## Resource requests/limits

| Container         | Requests CPU / RAM | Limits CPU / RAM | QoS         |
|-------------------|--------------------|------------------|-------------|
| `mongodb-*`       | 500m / 1Gi         | 2 / 4Gi          | Burstable   |
| `rabbitmq`        | 250m / 512Mi       | 1 / 1Gi          | Burstable   |
| `frontend`        | 100m / 256Mi       | 1 / 1Gi          | Burstable   |
| `email-notifier`  | 50m / 64Mi         | 200m / 128Mi     | Burstable   |
| `bot-bazos`       | 100m / 128Mi       | 500m / 256Mi     | Burstable   |
| `bot-sreality`    | 150m / 192Mi       | 750m / 384Mi     | Burstable   |
| `bot-bezrealitky` | 150m / 192Mi       | 750m / 384Mi     | Burstable   |

Note: the thesis §3.4 "Quality of Service" passage mentions critical
services should be `Guaranteed`. To get Guaranteed, requests must
equal limits. Update Mongo + RabbitMQ to use matching values
(`1 / 2Gi` requests = `1 / 2Gi` limits) **if** the cluster's actual
free capacity supports it; otherwise stay Burstable and note this
discrepancy explicitly in the task PR. The fit-on-mini-PC budget is
tight.

The "match requests=limits for Guaranteed" choice is a deploy-time
ops call. Default this task to Burstable with the numbers above; flag
in the PR that switching to Guaranteed for Mongo+RabbitMQ is a
two-line change once the operator confirms headroom.

## Concrete changes

For every Deployment / StatefulSet under `k3s/base/`, add:
- `spec.template.spec.affinity` per the matrix.
- `spec.template.spec.tolerations` for RPi5-eligible workloads.
- `spec.template.spec.containers[].resources` per the table.

Create `k3s/runbook.md` with the node-labelling + taint commands.

## Acceptance criteria
- After applying the manifests, `kubectl get pods -o wide -n dp-reality`
  shows every pod scheduled to the correct node per the matrix.
- Deleting and recreating a `bot-bazos` pod 10× in a row lands on
  RPi5 the majority of the time (soft preference holds).
- Tainted node rejects pods without the toleration (verifiable by
  removing the toleration on `bot-bazos` and watching the pod stay
  `Pending`).

## Open questions
- **Mongo Guaranteed QoS.** Defer the decision to operator; default
  to Burstable. Confirm during cluster bring-up.
- **`bot-bazos` preferred-vs-required on RPi5.** If RPi5 hardware
  ever flaps, soft preference lets the workload fall back to the
  Minisforum. Keep soft.
