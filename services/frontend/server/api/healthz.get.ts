// Unauthenticated liveness/readiness probe target for K3s.
// Returns `{ ok: true }` with status 200 whenever the Nitro process
// is responsive. No DB or RabbitMQ check: probes must not fail when
// downstreams blip (kubelet would restart the pod and amplify the
// outage). The BFF is "live" if its event loop can answer.
export default defineEventHandler(() => ({ ok: true }))
