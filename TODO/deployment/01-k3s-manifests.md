# deployment/01 — Core K3s manifests

## Goal
Produce the Deployments, Services, ConfigMaps, Secrets, and Ingress
that make the application stack runnable on K3s. This task does NOT
attempt to do node placement, NetworkPolicies, HPA, GitOps, or
secrets-at-rest — each of those is a follow-up task.

## Thesis references
- `03-architecture-design.tex` §3.4 (Deployment and Scaling Strategy)
- `03-architecture-design.tex` §3.5 (Infrastructure Design)
- `03-architecture-design.tex` §3.6 (Microservices Design)

## Current state
- `k3s/` contains only setup docs and a `whoami` demo.
- All actual deployments are Docker Compose.

## Scope
In: a `k3s/base/` tree per `deployment/00-overview.md` layout
containing manifests for every long-running workload, plus an
Ingress + cert-manager `ClusterIssuer` for TLS termination on the
BFF. Out: node affinity, taints, tolerations, resource limits (task
02). Out: NetworkPolicies (task 04).

## Concrete changes

### Directory layout
```
k3s/base/
  namespace.yaml
  configmaps/
    bot-bazos.yaml
    bot-sreality.yaml
    bot-bezrealitky.yaml
    email-notifier.yaml
    frontend.yaml
  secrets/
    bot-bazos.yaml
    bot-sreality.yaml
    bot-bezrealitky.yaml
    email-notifier.yaml
    frontend.yaml
    rabbitmq.yaml
    mongodb.yaml
  rabbitmq/
    statefulset.yaml
    service.yaml
    pvc-storageclass-note.md
  bot-bazos/
    deployment.yaml
    service.yaml
  bot-sreality/
    deployment.yaml
    service.yaml
  bot-bezrealitky/
    deployment.yaml
    service.yaml
  email-notifier/
    deployment.yaml
  frontend/
    deployment.yaml
    service.yaml
  ingress/
    ingress.yaml
    clusterissuer.yaml
  kustomization.yaml
```

(MongoDB lives in `k3s/base/mongodb/` but its content is the
responsibility of task 03 — leave that directory empty here with a
`.gitkeep` and a one-line note pointing at task 03.)

### Naming conventions
- Namespace: `dp-reality`.
- Service names = container names = `bot-bazos`, `bot-sreality`,
  `bot-bezrealitky`, `email-notifier`, `frontend`, `rabbitmq`. These
  match the existing compose service names so the bot services'
  hard-coded `BASE_URL=http://<service>:8000` resolves unchanged.
- Image references: `ghcr.io/${OWNER}/dp-reality/<service>:${TAG}`.
  Use a placeholder `:latest` here; task 05 (CI) and task 07 (Flux
  with image-automation) replace this with sha-pinned tags.

### Manifest contents (per workload, abbreviated)

For each bot service and the email-notifier:
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <service>
  labels: { app.kubernetes.io/...: ... }
spec:
  replicas: 1
  selector: { matchLabels: { app.kubernetes.io/name: <service> } }
  template:
    metadata: { labels: ... }
    spec:
      containers:
        - name: <service>
          image: ghcr.io/${OWNER}/dp-reality/<service>:latest
          envFrom:
            - configMapRef: { name: <service> }
            - secretRef: { name: <service> }
          ports:
            - containerPort: 8000   # bots only; email-notifier has none
          readinessProbe:
            httpGet: { path: /healthz, port: 8000 }
            initialDelaySeconds: 3
            periodSeconds: 10
          livenessProbe:
            httpGet: { path: /healthz, port: 8000 }
            periodSeconds: 30
```

The email-notifier has no HTTP server — its readiness is implicit
(consumer goroutine running). Add an init-style readiness via a
sidecar or simply omit probes; document the choice.

Each bot's Service:
```yaml
apiVersion: v1
kind: Service
metadata:
  name: <service>
spec:
  selector: { app.kubernetes.io/name: <service> }
  ports:
    - port: 8000
      targetPort: 8000
      protocol: TCP
```

The Frontend Deployment:
- Image: `ghcr.io/${OWNER}/dp-reality/frontend:latest`
- Port 3000.
- Probes: `/api/notifications/count` is auth-required; instead use a
  dedicated `/api/healthz` endpoint — **add it** as part of this
  task (`server/api/healthz.get.ts` returns `{ ok: true }` without
  any auth check).

RabbitMQ StatefulSet:
- `rabbitmq:3.13-management-alpine` (same as compose).
- One replica, one PVC bound to a `local-path` storage class
  (K3s default). Document the PVC reclaim policy.
- Two services: the AMQP `rabbitmq:5672` (used by every bot) and a
  ClusterIP `rabbitmq-mgmt:15672` exposed only inside the cluster.
  No ingress for the management UI.

### Ingress (BFF only — only externally exposed component per §3.7)
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
spec:
  ingressClassName: traefik    # K3s ships traefik by default
  tls:
    - hosts: [ reality.ryxwaer.com ]   # match APP_BASE_URL
      secretName: frontend-tls
  rules:
    - host: reality.ryxwaer.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: frontend, port: { number: 3000 } }
```

ClusterIssuer (Let's Encrypt prod, HTTP-01 via Traefik):
```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@ryxwaer.com   # placeholder
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers:
      - http01: { ingress: { class: traefik } }
```

Document in `deployment/00-overview.md` that cert-manager must be
installed before the ClusterIssuer applies (Flux can handle this as
an ordering dependency in task 07).

### ConfigMaps & Secrets

Per-service ConfigMap carries the non-secret env (e.g.
`SERVICE_ID`, `DISPLAY_NAME`, `BASE_URL`, `SCRAPE_INTERVAL_MINUTES`,
`APP_BASE_URL`, `MAIL_SMTP_SERVER`, `MAIL_SMTP_PORT`,
`MAIL_FROM_EMAIL`).

Per-service Secret carries:
- `MONGODB_URI_*` (the service-specific URI from `platform/02`).
- `RABBITMQ_URL`.
- `MAIL_SMTP_LOGIN`, `MAIL_SMTP_PASSWORD` (email-notifier only).
- `UNSUBSCRIBE_SECRET` (frontend + email-notifier).
- `NUXT_SESSION_PASSWORD` (frontend only — though after security/01
  the cookie carries only the session id, this still seeds the
  random source if anything).

Leave the Secret values as placeholders (the words `REPLACE_ME` or
similar). Task 08 wires them up via SealedSecrets/SOPS.

### Kustomization
`k3s/base/kustomization.yaml` lists every manifest. The `overlays/prod/`
overlay sets image tags and namespace, nothing else for now.

## Acceptance criteria
- `kustomize build k3s/base | kubectl apply -f -` (with the placeholder
  secrets manually substituted) brings up every workload in a fresh
  K3s cluster.
- `bot-bazos` resolves `http://rabbitmq:5672` via cluster DNS.
- The frontend's `/api/healthz` returns 200 from a pod IP.
- The Ingress responds (in a real cluster with DNS pointing at the
  Minisforum's Tailscale IP) on `https://reality.ryxwaer.com/`.

## Open questions
- **Domain name.** `reality.ryxwaer.com` is read from `compose.yml`.
  Confirm this is the production target before committing the
  hostname; allow override via overlay if needed.
- **Traefik vs. ingress-nginx.** K3s ships Traefik by default. Stick
  with it; switching is not in scope.
