# deployment/06 — HorizontalPodAutoscaler on the BFF

## Goal
Add the HPA the thesis §3.4 "Autoscaling" passage describes: scale
the BFF on CPU > 70%. The thesis flags this as *"an architectural
decision about how each component would scale as the platform grew,
not a current operational necessity"* — so this task ships the HPA
in a configuration that practically never scales today, but
demonstrates the mechanism.

## Thesis references
- `03-architecture-design.tex` §3.4 "Autoscaling":
  > "A Horizontal Pod Autoscaler is configured on the BFF, adding
  > replicas when average CPU exceeds 70%, because the BFF is the
  > component facing externally driven, bursty traffic (page views,
  > configuration popups, SSE connections)."

## Dependencies
- `deployment/01-k3s-manifests.md` (frontend Deployment exists).
- `deployment/02-node-placement-and-resources.md` (resource requests
  exist — HPA's CPU metric is a percentage of *request*).
- `security/01-mongo-backed-sessions.md` (sessions in Mongo — without
  this, scaling the BFF horizontally means cookie-only sessions are
  still bound to the replica that issued them; the SSE bridge also
  relies on the in-process inbox-bus subscription, which is
  per-replica).
- See SSE-bridge caveat below.

## SSE caveat
The current SSE inbox bridge (`server/plugins/inbox-events.ts` +
`server/utils/inbox-bus.ts`) subscribes one AMQP consumer per Nitro
process, fans events into an in-process `EventEmitter`, and the
`/api/sse/inbox` endpoint hooks into it. **This works correctly
across replicas** because the AMQP exchange is fanout — every
replica gets every event and delivers it to whatever sessions are
connected to it. No code change needed for HPA correctness, but
**document this** in the HPA task PR.

## Concrete changes

### Manifest
`k3s/base/hpa/frontend.yaml`:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: frontend
  namespace: dp-reality
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: frontend
  minReplicas: 1
  maxReplicas: 3
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
    scaleUp:
      stabilizationWindowSeconds: 30
```

`maxReplicas: 3` is a conservative cap given the cluster has two
nodes and only the Minisforum is allowed to host the BFF (per
deployment/02). The HPA will not exceed the node's capacity in
practice.

### Metrics server
HPA needs metrics-server. K3s ships it by default but verify it's
running:
```
kubectl get deploy -n kube-system metrics-server
```
Document in `k3s/runbook.md` that metrics-server is a prereq and
how to (re-)install if missing.

### Kustomization
Add `hpa/frontend.yaml` to `k3s/base/kustomization.yaml`.

## Acceptance criteria
- `kubectl get hpa -n dp-reality` shows the HPA in `current:` reporting
  a CPU number (not `<unknown>`).
- Synthetic load (e.g. `hey -z 60s -c 50 https://reality.ryxwaer.com/`)
  causes the replica count to climb above 1 within ~60 seconds.
- Removing load causes it to fall back to 1 within ~5 minutes
  (stabilizationWindow).

## Open questions
- **Sticky SSE connections.** When the HPA scales up, the Ingress
  controller routes new requests round-robin. Existing SSE
  connections stay on their replica; no problem. When the HPA scales
  down, in-flight SSE connections on the doomed replica are
  terminated and the browser auto-reconnects to a survivor. Fine.
