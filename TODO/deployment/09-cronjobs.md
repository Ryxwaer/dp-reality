# deployment/09 — CronJobs for periodic platform sweeps

## Goal
Move the two periodic platform routines into K3s CronJobs:
1. The daily expires_at sweep from `platform/01-expires-at-daily-sweep.md`.
2. The 5-minute provisional-bots janitor that today lives inside the
   Nitro process at
   `services/frontend/server/tasks/janitor/provisional-bots.ts`.

## Thesis references
- `03-architecture-design.tex` §3.4 (deployment): CronJobs called out
  as the standard Kubernetes mechanism. The thesis does not require
  the janitor specifically to be a CronJob, but moving it out of the
  Nitro process is the right shape under HPA (one task instance
  cluster-wide instead of one per replica).

## Dependencies
- `deployment/01-k3s-manifests.md` (frontend image exists).
- `platform/01-expires-at-daily-sweep.md` (the standalone script
  `scripts/sweep-expired-bots.mjs` exists in the frontend image).

## Concrete changes

### Directory
`k3s/base/cronjobs/`:
- `sweep-expired-bots.yaml`
- `provisional-bots-janitor.yaml`

### Sweep CronJob
```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: sweep-expired-bots
  namespace: dp-reality
spec:
  schedule: "0 3 * * *"     # 03:00 UTC daily
  concurrencyPolicy: Forbid
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          affinity: { ... }  # pin to amd64 per deployment/02
          containers:
            - name: sweep
              image: ghcr.io/${OWNER}/dp-reality/frontend:latest
              command: ["node", "scripts/sweep-expired-bots.mjs"]
              envFrom:
                - secretRef: { name: frontend }
              resources:
                requests: { cpu: 50m, memory: 64Mi }
                limits:   { cpu: 200m, memory: 128Mi }
```

### Provisional-bots janitor CronJob
The Nitro task at
`services/frontend/server/tasks/janitor/provisional-bots.ts` already
exports its sweep behaviour. Extract its body into a standalone
script `scripts/janitor-provisional-bots.mjs` (analogous to
`sweep-expired-bots.mjs`). Keep the Nitro task for dev (it's nice in
the compose stack) but the prod path runs the CronJob.

CronJob spec mirrors the sweep but at `*/5 * * * *`.

### Remove the in-process scheduler in prod
Update `services/frontend/nuxt.config.ts` to honour an env var
`NUXT_JANITOR_IN_PROCESS=false` that disables the
`scheduledTasks` block. In compose dev, the var is `true` (in-process
janitor); in K3s, the ConfigMap sets it to `false`.

## Acceptance criteria
- `kubectl get cronjob -n dp-reality` shows both CronJobs scheduled.
- A manual `kubectl create job --from=cronjob/sweep-expired-bots
  sweep-test` produces a Pod that exits 0 within ~10 seconds (modulo
  Mongo latency) and logs the JSON summary.
- In the K3s deployment, the in-process Nitro scheduler is silent —
  verified by tailing the frontend pod's logs over a 30-minute
  window and seeing no janitor logs from that path.
- In the compose dev stack, the in-process janitor still runs.

## Open questions
- **Time zone.** CronJob schedules are UTC. The sweep at `0 3 * * *`
  = 03:00 UTC = 04:00 CET / 05:00 CEST. Acceptable; document.
- **Concurrent run protection.** `concurrencyPolicy: Forbid` is
  sufficient because the sweep is idempotent regardless.
