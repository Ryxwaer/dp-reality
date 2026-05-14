# K3s deployment runbook — `dp-reality` on minisforum

Operator-side instructions for the **phase-1 single-node K3s deployment**
on `server.ryxwaer.com` (alias `minisforum`). The cluster coexists with
the existing `nginx-proxy-manager` + Docker stack on the same host; the
existing services are not touched.

Phases 2 (GHA + HPA + Flux) and 3 (SOPS + CronJobs) are deferred and
have their own future runbook sections at the bottom.

## Topology in phase 1

```
internet ─► nginx-proxy-manager (Docker, host :80/:443, owns TLS)
                │
                └─ proxies reality.ryxwaer.com → 127.0.0.1:30080
                                                       │
              ┌────────────────────────────────────────┘
              ▼
           K3s Service `frontend` (NodePort :30080)
              │
              ▼
           K3s pod `frontend-xxx` :3000
              │
              ▼
           cluster-internal: rabbitmq, mongodb, bot-bazos, bot-sreality, email-notifier
```

Everything inside the cluster talks via cluster DNS (`rabbitmq:5672`,
`mongodb-0.mongodb:27017`, etc.). The only host port the cluster opens
is `30080` for the BFF NodePort.

## Hostname / port assignments (phase 1, fixed)

| Concern                         | Value                                      |
| ------------------------------- | ------------------------------------------ |
| Namespace                       | `dp-reality`                               |
| Cluster DNS suffix              | `dp-reality.svc.cluster.local`             |
| BFF NodePort                    | `30080` (NPM upstream)                     |
| K3s API                         | `:6443`                                    |
| MongoDB replica set name        | `dp-rs`                                    |
| GHCR image namespace            | `ghcr.io/ryxwaer/dp-reality/<service>`     |

## Prerequisites on the host

- Fedora CoreOS (or whatever currently runs `nginx-proxy-manager`).
- `nginx-proxy-manager` already running; do not stop or reconfigure it
  except for the upstream change in the final step.
- The existing Docker `dp-reality` stack may stay running until the
  K3s cutover is verified; afterwards stop it (`docker compose down`)
  to free the rabbit/mongo/bot ports.

## 1. Install K3s in coexistence mode

SSH to the box:

```bash
ssh core@server.ryxwaer.com -p 2222
```

Install K3s **without** the bundled Traefik Ingress and ServiceLB —
those bind host :80/:443 and would clash with NPM:

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable=traefik --disable=servicelb --disable=metrics-server=false --write-kubeconfig-mode=644" sh -s -
```

Notes:

- `--disable=traefik` — we don't need a K3s Ingress in phase 1; NPM
  is the front-door. Traefik can be re-enabled in a later phase if
  cert-manager + ACME inside K3s is wanted.
- `--disable=servicelb` — disables K3s's Klipper LB (which would
  also try to bind 80/443).
- `metrics-server` is kept (HPA in phase 2 needs it).
- Kubeconfig is world-readable so non-root `core` can `kubectl`.

Verify:

```bash
sudo k3s kubectl get nodes -o wide
sudo k3s kubectl -n kube-system get pods
```

Export kubeconfig for your shell:

```bash
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
kubectl get nodes
```

(If you'd rather operate from your laptop instead of the server, scp
that file down and rewrite `server: https://127.0.0.1:6443` to
`https://server.ryxwaer.com:6443`. Phase-1 ops here assume you run
`kubectl` on the server.)

### Fedora CoreOS / SELinux note

If K3s fails to start with `permission denied` on `/usr/local/bin/k3s`
(seen in `journalctl -u k3s`: `Unable to locate executable
'/usr/local/bin/k3s': Permission denied`), restore the binary's SELinux
context — the K3s installer copies the binary into `/var/usrlocal/bin`
with the `user_tmp_t` label which the systemd unit can't exec:

```bash
sudo restorecon -v /usr/local/bin/k3s
sudo systemctl restart k3s
```

(`restorecon` resets the label to `container_runtime_exec_t`, which is
what the bundled SELinux policy expects.)

## 2a. (only if GHCR packages are private) GHCR pull secret

The CI workflow pushes images to `ghcr.io/ryxwaer/dp-reality/<svc>`.
GHCR packages are private by default. The cluster needs either:

- Public packages (no pull secret needed) — flip each package on
  <https://github.com/Ryxwaer?tab=packages> → package settings →
  Change visibility → Public; **or**
- A pull secret using a GitHub PAT with `read:packages`:

```bash
PAT='ghp_***********************************'
kubectl -n dp-reality create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io \
  --docker-username=Ryxwaer \
  --docker-password="$PAT" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n dp-reality patch serviceaccount default \
  -p '{"imagePullSecrets": [{"name": "ghcr-pull"}]}'
```

The PAT path is what the current cluster uses. Rotate by replacing the
secret in place; pods pick up the new credential on next pull.

## 2b. Install the NetworkPolicy enforcer (kube-router)

K3s ships Flannel as the CNI, which **does not enforce
NetworkPolicies**. The `k3s/base/networkpolicies/` manifests in this
repo are no-ops unless a controller honours them. Install kube-router
as a sidecar enforcer (lighter-weight than swapping to Calico):

```bash
kubectl apply -f https://raw.githubusercontent.com/cloudnativelabs/kube-router/v2.1.2/daemonset/kube-router-firewall-daemonset.yaml
```

This DaemonSet only runs the **NetworkPolicy controller** half of
kube-router (it leaves Flannel responsible for pod CIDR + routing).

Verify:

```bash
kubectl -n kube-system get ds kube-router
kubectl -n kube-system logs -l k8s-app=kube-router --tail=20
```

### When MongoDB / RabbitMQ are applied before their Secrets exist

The container entrypoints bootstrap their on-disk state from the env
vars in their Secrets on the FIRST boot only. If you apply the
manifests before populating the Secrets (step 4 below), `mongod`
materialises the keyfile as the literal string `REPLACE_ME` and
RabbitMQ creates no admin user. The recovery is to wipe the PVC and
let the pod re-init clean:

```bash
# MongoDB
kubectl -n dp-reality scale sts mongodb --replicas=0
kubectl -n dp-reality delete pvc data-mongodb-0
kubectl -n dp-reality scale sts mongodb --replicas=1

# RabbitMQ
kubectl -n dp-reality scale sts rabbitmq --replicas=0
kubectl -n dp-reality delete pvc data-rabbitmq-0
kubectl -n dp-reality scale sts rabbitmq --replicas=1
```

The cleanest install order (no recovery needed) is: apply manifests
in step 3, populate Secrets in step 4 BEFORE the pods get past
`ImagePullBackOff` / `CreateContainerConfigError`. The pods don't
actually start until both the image is pullable AND the Secret values
exist, so the first-boot bootstrap then sees real values.

## 3. Apply the workload manifests

From your laptop (or wherever the repo is checked out):

```bash
cd /path/to/dp-reality

# Sanity check — should print a long YAML stream, no errors:
kubectl kustomize k3s/overlays/prod

# Apply:
kubectl apply -k k3s/overlays/prod
```

This creates the `dp-reality` namespace, every ConfigMap, every
Secret (with placeholder values — see step 4), the MongoDB and
RabbitMQ StatefulSets, all four service Deployments, and the
NetworkPolicies.

## 4. Populate the placeholder Secrets

Phase 3 (SOPS) replaces this manual step; for phase 1 the operator
fills the Secret values in-cluster:

```bash
# RabbitMQ admin credentials (any strong values; bots will use them).
kubectl -n dp-reality create secret generic rabbitmq \
  --from-literal=RABBITMQ_DEFAULT_USER="$(openssl rand -hex 8)" \
  --from-literal=RABBITMQ_DEFAULT_PASS="$(openssl rand -hex 24)" \
  --dry-run=client -o yaml | kubectl apply -f -

# MongoDB root + replica-set keyfile.
# The keyfile is 1024 random bytes (base64), used for internal RS auth.
MONGO_KEYFILE="$(openssl rand -base64 756 | tr -d '\n')"
kubectl -n dp-reality create secret generic mongodb \
  --from-literal=MONGO_INITDB_ROOT_USERNAME="root" \
  --from-literal=MONGO_INITDB_ROOT_PASSWORD="$(openssl rand -hex 24)" \
  --from-literal=keyfile="$MONGO_KEYFILE" \
  --dry-run=client -o yaml | kubectl apply -f -

# Then bot service URIs reference the Mongo root user for phase 1.
# (platform/02 will switch each bot to its own dedicated Mongo user.)
MONGO_USER="$(kubectl -n dp-reality get secret mongodb -o jsonpath='{.data.MONGO_INITDB_ROOT_USERNAME}' | base64 -d)"
MONGO_PASS="$(kubectl -n dp-reality get secret mongodb -o jsonpath='{.data.MONGO_INITDB_ROOT_PASSWORD}' | base64 -d)"
RMQ_USER="$(kubectl -n dp-reality get secret rabbitmq -o jsonpath='{.data.RABBITMQ_DEFAULT_USER}' | base64 -d)"
RMQ_PASS="$(kubectl -n dp-reality get secret rabbitmq -o jsonpath='{.data.RABBITMQ_DEFAULT_PASS}' | base64 -d)"

MONGO_URI="mongodb://${MONGO_USER}:${MONGO_PASS}@mongodb-0.mongodb:27017/dp-reality?replicaSet=dp-rs&authSource=admin"
RMQ_URL="amqp://${RMQ_USER}:${RMQ_PASS}@rabbitmq:5672/"

for svc in bot-bazos bot-sreality email-notifier; do
  kubectl -n dp-reality create secret generic "$svc" \
    --from-literal=MONGODB_URI="$MONGO_URI" \
    --from-literal=RABBITMQ_URL="$RMQ_URL" \
    --dry-run=client -o yaml | kubectl apply -f -
done

# email-notifier additionally needs SMTP credentials and the
# unsubscribe HMAC secret.
kubectl -n dp-reality patch secret email-notifier --type=merge -p "$(cat <<EOF
{"stringData": {
  "MAIL_SMTP_LOGIN": "REPLACE_ME",
  "MAIL_SMTP_PASSWORD": "REPLACE_ME",
  "UNSUBSCRIBE_SECRET": "$(openssl rand -hex 32)"
}}
EOF
)"

# Frontend: Mongo, Rabbit, session password, unsubscribe secret.
# The unsubscribe secret MUST match email-notifier's.
UNSUB="$(kubectl -n dp-reality get secret email-notifier -o jsonpath='{.data.UNSUBSCRIBE_SECRET}' | base64 -d)"
kubectl -n dp-reality create secret generic frontend \
  --from-literal=NUXT_MONGODB_URI="$MONGO_URI" \
  --from-literal=NUXT_RABBITMQ_URL="$RMQ_URL" \
  --from-literal=NUXT_UNSUBSCRIBE_SECRET="$UNSUB" \
  --from-literal=NUXT_SESSION_PASSWORD="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

After patching the secrets, restart the affected deployments so the
new env is picked up:

```bash
kubectl -n dp-reality rollout restart deploy/bot-bazos deploy/bot-sreality deploy/email-notifier deploy/frontend
```

## 5. Initialise the MongoDB replica set

The MongoDB StatefulSet boots in standalone replica-set-uninitialised
mode. Initialise the single-member replica set once:

```bash
kubectl -n dp-reality wait --for=condition=Ready pod/mongodb-0 --timeout=180s

MONGO_USER="$(kubectl -n dp-reality get secret mongodb -o jsonpath='{.data.MONGO_INITDB_ROOT_USERNAME}' | base64 -d)"
MONGO_PASS="$(kubectl -n dp-reality get secret mongodb -o jsonpath='{.data.MONGO_INITDB_ROOT_PASSWORD}' | base64 -d)"

kubectl -n dp-reality exec -it mongodb-0 -- \
  mongosh --quiet -u "$MONGO_USER" -p "$MONGO_PASS" --authenticationDatabase admin --eval '
rs.initiate({
  _id: "dp-rs",
  members: [{ _id: 0, host: "mongodb-0.mongodb:27017", priority: 2 }]
})
'
```

You can later add the RPi5 member with:

```bash
# (after the RPi5 has joined the cluster and mongodb-1 is Running)
rs.add({ host: "mongodb-1.mongodb:27017", priority: 1 })
```

Without changing anything else — the connection string already lists
the headless service and `?replicaSet=dp-rs`, so drivers pick up the
new member automatically.

## 6. Point NPM at the K3s frontend

In nginx-proxy-manager's UI, edit the `reality.ryxwaer.com`
proxy host:

- **Scheme**: `http`
- **Forward Hostname / IP**: `192.168.1.138` (the host's primary LAN
  IP — NOT `127.0.0.1`, since inside the NPM container that resolves
  to NPM's own loopback). `172.17.0.1` (the default `docker0` bridge
  gateway) also works.
- **Forward Port**: `30080`
- **Cache assets**: off
- **WebSocket support**: on  (the inbox uses SSE, which NPM treats as
  a long-lived HTTP response; WebSocket support keeps NPM from
  buffering the stream)
- **Access list / SSL settings**: unchanged (NPM keeps owning TLS)

Verify in a browser: `https://reality.ryxwaer.com/` → K3s frontend
serves the login page.

Smoke test from the host:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://reality.ryxwaer.com/api/healthz   # 200
curl -sS https://reality.ryxwaer.com/api/modules/registry                            # 2 bot rows
```

## 7. Final sanity check

```bash
kubectl -n dp-reality get pods -o wide
kubectl -n dp-reality get svc
kubectl -n dp-reality logs deploy/frontend --tail=50
kubectl -n dp-reality logs deploy/bot-bazos --tail=50

# Confirm bots self-registered:
kubectl -n dp-reality exec -it mongodb-0 -- \
  mongosh --quiet -u "$MONGO_USER" -p "$MONGO_PASS" \
  --authenticationDatabase admin --eval 'use dp-reality; db.module_registry.find().pretty()'
```

You should see one `module_registry` row per bot service.

## 8. Cutover from the Docker `dp-reality` stack

Once the K3s deployment is verified healthy, stop the Docker stack so
the host ports (`rabbitmq` admin etc., if you previously exposed
them) free up:

```bash
cd /path/to/the/docker/dp-reality
docker compose down
```

The external Mongo + the legacy database stay untouched. K3s does not
use them.

---

## Phase 2 — Flux CD bootstrap (continuous delivery)

After this section the cluster pulls from this Git repo on its own.
`kubectl apply -k` is no longer the supported deploy path; pushes to
`main` are.

### 2.1 What gets installed

`flux bootstrap github` does three things in one shot:

1. Installs the Flux controllers into the cluster's `flux-system`
   namespace (source-controller, kustomize-controller, notification-
   controller, helm-controller, plus — because we pass
   `--components-extra` — image-reflector-controller and
   image-automation-controller).
2. Creates a deploy key on the GitHub repo with write access and
   stores it in-cluster as the `flux-system` GitRepository source.
3. Commits the controller manifests into the repo under
   `flux/clusters/prod/flux-system/`, plus a `gotk-sync.yaml`
   `Kustomization` that points back at the same directory. Subsequent
   reconciles pull `flux/clusters/prod/` and apply everything in it.

After bootstrap, the rest of this directory (`apps.yaml`,
`image-policies.yaml`, `image-updates.yaml`) is already committed by
us and reconciled automatically.

### 2.2 Prerequisites

- A GitHub Personal Access Token with **`repo`** and
  **`read:packages`** scopes. The same PAT is used for both the
  bootstrap (`repo` for repo write access) and the GHCR pull
  credential in 2.4 (`read:packages` for image-reflector to list
  tags on the private packages).
- `flux` CLI on the operator workstation:
  ```bash
  curl -s https://fluxcd.io/install.sh | sudo bash
  flux --version
  ```
- `kubectl` already configured against the K3s cluster (Phase 1
  step 1 covered this).

### 2.3 Run the bootstrap

```bash
export GITHUB_USER=Ryxwaer
export GITHUB_TOKEN='ghp_***********************************'

flux bootstrap github \
  --owner="$GITHUB_USER" \
  --repository=dp-reality \
  --branch=main \
  --path=flux/clusters/prod \
  --personal \
  --read-write-key \
  --components-extra=image-reflector-controller,image-automation-controller
```

What this command does, in order:

1. Pushes `flux/clusters/prod/flux-system/{gotk-components,gotk-sync}.yaml`
   to `main`.
2. Creates the `flux-system` namespace and applies those manifests.
3. Generates a Deploy Key on the GitHub repo (visible under
   `Settings → Deploy keys`) with **read+write** access. Flux uses
   it to commit image-tag bumps back to `main`.
4. Reconciles. From this point `flux get all -n flux-system` should
   show every Kustomization, GitRepository, and image-automation
   resource as `Ready`.

If you ever need to re-run the bootstrap (e.g., to rotate the deploy
key), delete the secret first:

```bash
kubectl -n flux-system delete secret flux-system
```

### 2.4 Give image-reflector access to GHCR (private packages)

The `ImageRepository` resources in
`flux/clusters/prod/image-policies.yaml` reference a `ghcr-auth`
secret in `flux-system`. Create it once with the same PAT
(`read:packages` is sufficient for this — `repo` is not required
here):

```bash
PAT="$GITHUB_TOKEN"  # or a separate read:packages-only PAT

kubectl -n flux-system create secret docker-registry ghcr-auth \
  --docker-server=ghcr.io \
  --docker-username="$GITHUB_USER" \
  --docker-password="$PAT" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 2.5 Verify

```bash
# All controllers + the bootstrap Kustomization are ready.
flux get all -n flux-system

# Image scanning sees tags from GHCR.
flux get image repository -n flux-system
flux get image policy     -n flux-system

# The first image-automation run rewrites the overlay; you'll see a
# commit by `fluxcdbot` on origin/main shortly:
git fetch && git log --oneline origin/main | head -3
```

After image-automation has bumped `k3s/overlays/prod/kustomization.yaml`,
the `dp-reality` Kustomization rolls each Deployment that referenced
the new tag. From now on every push to `main` triggers:

```
GitHub push  →  CI builds image, tags main-<sha8>-<epoch>  →
  Flux image-reflector sees new tag  →
    Flux image-automation commits new tag into overlay  →
      Flux kustomize-controller rolls the Deployments
```

End-to-end latency is dominated by CI build (~3 min for arm64 bots,
~3 min for amd64 frontend), plus Flux's image scan interval (1 min)
and apply interval (5 min). Worst case: ~10 min from push to
production.

### 2.6 Manual override (still possible)

Flux drift-corrects, so editing a Deployment with `kubectl edit` is
reverted within 5 min. If you need to pause Flux for a debug session:

```bash
flux suspend kustomization dp-reality
# ... make changes ...
flux resume  kustomization dp-reality
```

A `flux reconcile kustomization dp-reality --with-source` triggers
an immediate sync.

## Phase 2 (deferred) — HPA

- `k3s/base/hpa/frontend.yaml` adds a CPU-based HorizontalPodAutoscaler
  on the BFF. Requires session-state in MongoDB (`TODO/security/01`)
  so multiple BFF replicas can share login state.

## Phase 3 (later) — SOPS + CronJobs

- `.sops.yaml` + per-Secret SOPS encryption.
- Daily `sweep-expired-bots` CronJob (FR-02-B).
- Provisional-bots janitor moved from the Nitro process to a CronJob.

---

## Adding the RPi5 worker (deferred)

When the RPi5 joins later:

1. Install K3s agent on the RPi5:
   ```bash
   curl -sfL https://get.k3s.io | K3S_URL=https://server.ryxwaer.com:6443 \
     K3S_TOKEN=<server-node-token> sh -s -
   ```
   (Get the token from `sudo cat /var/lib/rancher/k3s/server/node-token`
   on minisforum.)
2. Label and taint per `TODO/deployment/02-node-placement-and-resources.md`:
   ```bash
   kubectl label   node rpi5 kubernetes.io/arch=arm64 dp-reality/location=cz
   kubectl taint   node rpi5 dp-reality/edge=true:NoSchedule
   ```
3. Re-enable the hard `nodeAffinity` and `tolerations` blocks in
   `k3s/base/*/deployment.yaml` that are commented out in phase 1.
4. Scale the Mongo StatefulSet to 2 replicas and `rs.add(...)` the
   new member as shown in step 5.
5. Switch the Mongo connection string to list both members:
   `mongodb-0.mongodb,mongodb-1.mongodb`.

No code changes in the application repo are required for this.
