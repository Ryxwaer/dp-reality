# K3s deployment runbook — `dp-reality` on minisforum

Operator-side instructions for the single-node K3s deployment on
`server.ryxwaer.com` (alias `minisforum`). The cluster coexists with
the existing `nginx-proxy-manager` + Docker stack on the same host;
the existing services are not touched.

Phases are layered on top of each other:

- **Phase 1** — K3s + raw `kubectl apply` of the workload (the
  bootstrap path; used once on a brand-new cluster).
- **Phase 2** — Flux CD GitOps (continuous delivery).
- **Phase 3** — SOPS encryption of Secrets at rest.
- **Phase B** — ingress-nginx + Prometheus + Flagger
  (progressive delivery / automatic rollback per thesis §3.4).

Phase B is the steady-state topology; phase 1 is preserved here for
disaster-recovery rebuilds.

## Topology (Phase B, current)

```
internet ─► nginx-proxy-manager (Docker, host :80/:443, owns TLS)
                │  Forward Host: 172.17.0.1 (or 192.168.1.138)
                │  Forward Port: 30090
                ▼
           K3s Service `ingress-nginx-controller` (NodePort :30090)
                │
                ▼ (routes by `Host: reality.ryxwaer.com`)
           Ingress `frontend` ───────────── Ingress `frontend-canary`
              │ (apex, 90%–100%)                │ (Flagger-managed,
              │                                 │  `canary-weight: N`)
              ▼                                 ▼
           Service `frontend`                Service `frontend-canary`
              │ (selects -primary pods)          │ (selects canary pods)
              ▼                                 ▼
           Deployment `frontend-primary`     Deployment `frontend`
           (Flagger-managed, always live)    (template; scaled to 0
              │                                 unless a canary is
              │                                 in progress)
              ▼
           cluster-internal: rabbitmq, mongodb, bot-bazos, bot-sreality,
           email-notifier (plain Deployments — no Flagger; see Phase B
           § "Why no canary for the bots?")
```

Everything inside the cluster talks via cluster DNS (`rabbitmq:5672`,
`mongodb-0.mongodb:27017`, etc.). The only host ports the cluster
opens are `30090` (ingress-nginx HTTP, NPM upstream) and `30443`
(ingress-nginx HTTPS, unused while NPM owns TLS — kept available for
future direct-TLS topologies). `30080` (the direct frontend NodePort)
was retired when Path B landed; the Service that backed it is now
owned by Flagger.

## Hostname / port assignments

| Concern                         | Value                                      |
| ------------------------------- | ------------------------------------------ |
| Namespace                       | `dp-reality`                               |
| Cluster DNS suffix              | `dp-reality.svc.cluster.local`             |
| ingress-nginx NodePort (HTTP)   | `30090` (NPM upstream)                     |
| ingress-nginx NodePort (HTTPS)  | `30443` (unused while NPM owns TLS)        |
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

This creates the `dp-reality` namespace, every ConfigMap, the MongoDB
and RabbitMQ StatefulSets, all four service Deployments, and the
NetworkPolicies. On a fresh cluster the Deployments stay in
`ContainerCreating` until step 4 completes (the kubelet waits for the
named Secrets to exist).

After Phase 3 (SOPS) is bootstrapped, `k3s/base/secrets/*.yaml` are
applied automatically by Flux (decrypted in-memory by the
kustomize-controller using the cluster age key); step 4 is then a
one-shot initial-population step only.

## 4. Seed Secret values

On a brand-new cluster the encrypted manifests in `k3s/base/secrets/`
need real values. Generate them once with the snippet below, then
encrypt with `sops` and commit (Phase 3 §3.3 has the editing
workflow). On an existing cluster these Secrets are already present
and Flux maintains them — you can skip this section.

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

# Frontend: Mongo, Rabbit, unsubscribe secret. Sessions live in Mongo
# now (collection `sessions`), so no shared cookie-sealing key is
# required across replicas. The unsubscribe secret MUST match
# email-notifier's.
UNSUB="$(kubectl -n dp-reality get secret email-notifier -o jsonpath='{.data.UNSUBSCRIBE_SECRET}' | base64 -d)"
kubectl -n dp-reality create secret generic frontend \
  --from-literal=NUXT_MONGODB_URI="$MONGO_URI" \
  --from-literal=NUXT_RABBITMQ_URL="$RMQ_URL" \
  --from-literal=NUXT_UNSUBSCRIBE_SECRET="$UNSUB" \
  --dry-run=client -o yaml | kubectl apply -f -
```

After patching the secrets, restart the affected deployments so the
new env is picked up:

```bash
kubectl -n dp-reality rollout restart deploy/bot-bazos deploy/bot-sreality deploy/email-notifier deploy/frontend
```

Once the cluster is happy, dump each Secret back to a plaintext
manifest under `k3s/base/secrets/<name>.yaml`, encrypt it with `sops
--encrypt --in-place …` (per Phase 3), and commit. From that point on
Flux is the sole owner of these Secrets.

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

## 6. Point NPM at ingress-nginx

In nginx-proxy-manager's UI, edit the `reality.ryxwaer.com`
proxy host:

- **Scheme**: `http`
- **Forward Hostname / IP**: `172.17.0.1` (the `docker0` bridge
  gateway — fastest path from inside the NPM container to a host
  NodePort). `192.168.1.138` (the host's primary LAN IP) also works.
  `127.0.0.1` does NOT — inside the NPM container that resolves
  to NPM's own loopback.
- **Forward Port**: `30090`  (ingress-nginx HTTP NodePort).
- **Cache assets**: off
- **WebSocket support**: on  (the inbox uses SSE, which NPM treats as
  a long-lived HTTP response; WebSocket support keeps NPM from
  buffering the stream)
- **Access list / SSL settings**: unchanged (NPM keeps owning TLS)

NPM preserves the `Host: reality.ryxwaer.com` header upstream, which
is exactly what ingress-nginx needs for its Ingress rule.

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

## Phase 3 — SOPS encryption of Secrets at rest

After this phase the GitOps repo can be public without leaking
credentials. Per thesis §3.7.2.

### 3.1 What gets installed

- `sops` and `age` on the operator workstation (already in the repo
  Read-me list of CLIs).
- A single cluster-wide age key:
  - **Public half** → committed in `.sops.yaml` at the repo root.
  - **Private half** → lives in-cluster as
    `flux-system/sops-age` (Secret), never committed anywhere.
- `flux/clusters/prod/apps.yaml` gains a `spec.decryption` block
  pointing at the in-cluster age key.
- `k3s/base/secrets/*.yaml` come back into Git, SOPS-encrypted.
- `.github/workflows/build-and-push.yml` gets a `secrets-lint` job
  that fails the CI if a Secret manifest is committed without SOPS.

### 3.2 One-off bootstrap

```bash
# Operator workstation — generate the age key pair.
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/dp-reality.agekey
PUBLIC_KEY=$(grep -oE 'age1[a-z0-9]+' ~/.config/sops/age/dp-reality.agekey | tail -1)
echo "$PUBLIC_KEY"

# Publish public half in .sops.yaml at repo root (commit it).

# Install private half into the cluster.
kubectl -n flux-system create secret generic sops-age \
  --from-file=age.agekey=$HOME/.config/sops/age/dp-reality.agekey \
  --dry-run=client -o yaml | kubectl apply -f -

# Back up the private key to a password manager or offline storage.
```

The `flux-system/sops-age` Secret is the master key for the cluster:
losing it means re-encrypting every committed Secret with a new key.
Keep a copy off-line.

### 3.3 Editing a Secret

```bash
export SOPS_AGE_KEY_FILE=$HOME/.config/sops/age/dp-reality.agekey

# Opens decrypted in $EDITOR, re-encrypts on save:
sops k3s/base/secrets/frontend.yaml

# Or as a one-off:
sops --decrypt k3s/base/secrets/frontend.yaml
```

Commit and push the new ciphertext. Flux picks it up within the
5-minute reconcile and rolls the consuming Deployments
(because the env-var hash changes).

### 3.4 Adding a new Secret

```bash
cat > k3s/base/secrets/new-thing.yaml <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: new-thing
  namespace: dp-reality
type: Opaque
stringData:
  TOKEN: "<plaintext>"
EOF

sops --encrypt --in-place k3s/base/secrets/new-thing.yaml
```

Then add the file to `k3s/base/kustomization.yaml`.

### 3.5 Rotating a leaked Secret

Same as 3.3 — open with `sops`, set a new value, save, commit, push.
The kustomize-controller applies the new ciphertext, K8s mutates the
Secret, and the env-var checksum change rolls the consuming pods.

## Adding a new deployable service

The repo is the source of truth for every deployable component, so
adding a new bot / helper / sidecar should be a matter of creating
files and pushing — no `kubectl apply` from a workstation, no "I'll
finish setting this up later" steps. The checklist below covers
*every* file an operator must touch; if you skip one of them the
deploy will fail in a visible way (image won't build, pod stays in
ImagePullBackOff, tag never bumps, secret applied as plaintext, …).

### A. Code

- `services/<name>/Dockerfile` — multi-stage if helpful, must
  produce an `amd64` (and ideally `arm64`) image.
- `services/<name>/src/` — the implementation. The contract the BFF
  reverse-proxies against (for bots) is documented in the thesis
  §3.6 and demonstrated by `services/bot-bazos/`.
- `services/<name>/requirements.txt` (Python) or `package.json`
  (Node).

The CI **build matrix is auto-discovered** from `services/*/Dockerfile`
(see `.github/workflows/build-and-push.yml`). Default platforms are
`linux/amd64,linux/arm64`. Add the service name to the `AMD64_ONLY`
list in that workflow if QEMU cross-build is too slow (currently only
`frontend`).

### B. Cluster manifests

- `k3s/base/<name>/deployment.yaml` — Deployment with the standard
  three labels (`app.kubernetes.io/part-of: dp-reality`,
  `component: <bot|bff|notifier|geo|…>`, `name: <name>`),
  `envFrom: [{configMapRef: <name>}, {secretRef: <name>}]`,
  `readinessProbe` and `livenessProbe` against `/healthz`.
- `k3s/base/<name>/service.yaml` — ClusterIP Service, same selector
  labels as the Deployment, port 8000 by convention.
- `k3s/base/configmaps/<name>.yaml` — non-secret env (`SERVICE_ID`,
  `BASE_URL`, scrape intervals, …).
- `k3s/base/secrets/<name>.yaml` — **MUST be SOPS-encrypted** before
  commit (cf. §3.4). Author the YAML with plaintext `stringData:`,
  then `sops --encrypt --in-place k3s/base/secrets/<name>.yaml`.
- Wire all four entries into `k3s/base/kustomization.yaml`.

### C. NetworkPolicy

The default-deny policy blocks all pod-to-pod traffic; per-component
allow-lists in `k3s/base/networkpolicies/` open the required edges.
The existing `bots.yaml` policy matches every Pod with
`app.kubernetes.io/component: bot`, so a new bot is covered the
moment its Deployment carries that label — no policy edit needed.
For other component classes (`geo`, `db`, …) add a new policy file
and wire it into the kustomization.

### D. Continuous delivery (Flux)

- `flux/clusters/prod/image-policies.yaml` — append an
  `ImageRepository` + `ImagePolicy` pair for the new image. Copy
  the existing `bot-bazos` block; only the `name:` and `image:`
  lines change.
- `k3s/overlays/prod/kustomization.yaml` — append an entry under
  `images:`:

  ```yaml
  - name: ghcr.io/ryxwaer/dp-reality/<name>
    newTag: latest # {"$imagepolicy": "flux-system:<name>:tag"}
  ```

  `latest` is the cold-start value; `image-update-automation` rewrites
  it to a sortable `main-<sha>-<epoch>` tag on the first reconcile.

### E. Optional surfaces

- **Tailnet exposure**: add `tailscale.com/expose: "true"` and
  `tailscale.com/hostname: <name>` annotations to the Service (cf.
  Phase C).
- **Public web access**: only the `frontend` is supposed to be on the
  public ingress (thesis §3.7.3). New services are expected to be
  consumed peer-to-peer inside the cluster.
- **Progressive delivery**: only the `frontend` runs through Flagger
  (cf. §B.4 for the rationale). Bots and helpers reroll directly via
  Flux Server-Side Apply.
- **Compose mirror**: if you want the service to spin up under
  `compose.yml` / `compose.dev.yml` for local dev, add a service
  block that mirrors the K8s Deployment env. This is convention, not
  required — production never uses compose.

### F. Ship it

```bash
git add -A
git commit -m "feat(<name>): …"
git push
```

The pipeline:

1. `build-and-push` discovers the new `services/<name>/Dockerfile`
   and builds + pushes a multi-arch image to GHCR.
2. `secrets-lint` confirms every `k3s/base/secrets/*.yaml` is
   SOPS-encrypted (it'll fail loudly if you forgot to encrypt step
   B.4).
3. Flux's `image-reflector` notices the new GHCR tag, the
   `ImagePolicy` resolves it, and `image-update-automation`
   rewrites the `newTag:` line in
   `k3s/overlays/prod/kustomization.yaml` and pushes a
   `chore(images): bump image tags` commit.
4. The `dp-reality` Kustomization reconciles, applies the
   Deployment/Service/ConfigMap/Secret, the kustomize-controller
   decrypts the SOPS-encrypted Secret in memory and creates it,
   and the new pod rolls out.

### What the cluster does *not* know about CI

Flux is a pull-based loop and does not consult GitHub Actions
status. A red `secrets-lint` does not stop Flux from applying a
plaintext Secret. If you push something that fails CI:

- Fix forward and push a new commit, or
- Revert the offending commit. Either way Flux converges on
  whatever HEAD on `main` says.

The corollary: **don't push secrets in plaintext**. The encryption
step in B.4 is not optional.

## Phase B — Ingress + Metrics + Progressive Delivery

Closes the "failed deployments trigger automatic rollback" claim in
thesis §3.4. Three Helm charts go in:

- **ingress-nginx 4.15.x** — in-cluster Ingress that sits between
  NPM and the workload Services. NPM no longer talks directly to a
  workload NodePort; it forwards to ingress-nginx on `:30090`, which
  routes by `Host: reality.ryxwaer.com`.
- **kube-prometheus-stack 85.x** — Prometheus + Grafana +
  node-exporter + kube-state-metrics. Flagger uses Prometheus to
  decide whether a canary is healthy. Alertmanager is disabled (no
  alerting routes yet); the K3s-unreachable control-plane scrapes
  (kube-controller-manager, kube-scheduler, kube-proxy, etcd) are
  also disabled.
- **Flagger 1.43.x** + **flagger-loadtester 0.37.x** — progressive
  delivery controller. `meshProvider: nginx`, `metricsServer`
  pointing at the in-cluster Prometheus.

All three are reconciled by Flux from `flux/infra/prod/` via the
`infra` Kustomization (`flux/clusters/prod/infra.yaml`). They have
no operator-side install step; once the cluster has Flux
(Phase 2 §2.3), the Kustomization brings them up on its own.

### B.1 The Canary CR (frontend only)

`k3s/base/frontend/canary.yaml` declares the BFF as a Canary:

- `provider: nginx` — Flagger annotates the canary Ingress with
  `nginx.ingress.kubernetes.io/canary-weight: N`; ingress-nginx
  splits traffic at the controller layer.
- `targetRef` → the `frontend` Deployment. The Deployment is a
  template; Flagger keeps it at `replicas: 0` and uses its spec to
  bootstrap `frontend-primary` (always-on) and, during a rollout,
  `frontend` itself (scaled to 1 only while the canary is in
  flight).
- `ingressRef` → the apex Ingress `frontend`. Flagger generates a
  sibling `frontend-canary` Ingress alongside it and rewrites
  `canary-weight` on each step.
- `analysis.maxWeight: 50` + `stepWeight: 10` — five 30 s steps of
  10 % → 20 % → … → 50 %. A bad image therefore takes ≤ 30 s of
  ≤ 10 % traffic before the first metric verdict, and ≤ 4 min total
  for a clean promote. Primary stays warm at 100 % of its own
  capacity throughout, so rollback is instant.
- `metrics` → custom `MetricTemplate`s (`k3s/base/frontend/metric-
  templates.yaml`) because the built-in NGINX queries Flagger ships
  filter by `ingress="<name>-canary"`, whereas ingress-nginx ≥ 1.5
  records canary requests under the apex Ingress (`ingress=
  "<name>"`) with the canary backend in a separate `canary` label.
  The custom templates rewrite the queries to match the actual
  metric shape.
- `webhooks` →
  - `smoke` (`pre-rollout`): the loadtester `curl`s
    `frontend-canary:3000/api/healthz` and aborts the canary if
    that returns ≠ 0.
  - `load-test` (`rollout`): 5 RPS × 2 workers × 60 s of
    `hey -host reality.ryxwaer.com http://ingress-nginx-controller`
    against `/api/healthz`. Keeps `nginx_ingress_controller_requests`
    populated even when real user traffic is sparse, so the success-
    rate metric never goes NaN and Flagger doesn't false-abort.

### B.2 Triggering a canary manually (thesis demo)

Any change to `spec.template` of the `frontend` Deployment triggers
analysis. The commit-friendly way is to bump
`CANARY_SMOKE_TEST` in `k3s/base/frontend/deployment.yaml`:

```bash
sed -i 's/value: "phase-b-bootstrap-v[0-9]*"/value: "phase-b-bootstrap-v9"/' \
  k3s/base/frontend/deployment.yaml
git add k3s/base/frontend/deployment.yaml
git commit -m "trigger canary smoke test"
git push
```

Flux reconciles (≤ 5 min), Flagger detects the new revision and
starts the analysis. Watch the progression:

```bash
kubectl -n dp-reality get canary frontend -w
# Optional, more detail:
kubectl -n dp-reality describe canary frontend | tail -25
kubectl -n flagger-system logs deploy/flagger -f | jq -r .msg
```

Successful run takes ~4–5 min from `Initialized` → `Progressing` →
`Promoting` → `Finalising` → `Succeeded`.

### B.3 Forcing a rollback (thesis demo, destructive)

Deploy a deliberately bad image to see Flagger abort:

```bash
# Bump the image to a known-bad tag (or any tag that fails smoke).
kubectl -n dp-reality set image deployment/frontend \
  frontend=ghcr.io/ryxwaer/dp-reality/frontend:does-not-exist
```

Watch:

```bash
kubectl -n dp-reality get canary frontend -w
```

Expected transition: `Progressing` → `Halt advancement` (× threshold)
→ `Failed`. `frontend-primary` is never touched; real users continue
to see the previous good version because they're routed exclusively
to primary while the canary builds.

Cleanup (the deliberately-broken Deployment spec drifts from Git
once you stop, so let Flux reconcile it back):

```bash
flux reconcile kustomization dp-reality --with-source
```

### B.4 Why no canary for the bots / email-notifier

The three message-queue consumers (`bot-bazos`, `bot-sreality`,
`email-notifier`) are deliberately left as plain Deployments with
the standard Kubernetes rolling-update strategy and readiness
probes. Rationale:

1. **Split-brain consumers.** A Flagger canary would run
   `<svc>-primary` and `<svc>` simultaneously, both consuming from
   the same RabbitMQ queue. A broken canary processes messages it
   shouldn't, and the damage is already done by the time the
   metric-based abort kicks in.
2. **No HTTP-level success metric.** The bots only expose
   `:8000/configure` to the BFF; there is no user-facing HTTP path
   with steady RPS that Flagger can compute a success-rate over.
   Wiring custom Prometheus counters for message-processing success
   would be a real instrumentation project, not a runbook step.
3. **Rolling update + readiness probe is already "stop if broken".**
   Both bots have `readinessProbe` and `livenessProbe` on
   `:8000/healthz`; the kubelet will not progress the rollout past a
   pod that never goes Ready. Operator notices the stuck rollout in
   `kubectl get pods` and reverts with `git revert`.

`email-notifier` doesn't even have HTTP and relies on the
crash-on-error semantics inside `services/email-notifier/main.go`.

### B.5 Grafana access

`kube-prometheus-stack` ships Grafana as a ClusterIP service with
auto-generated admin credentials. Retrieve the admin password with:

```bash
kubectl -n monitoring get secret kube-prometheus-stack-grafana \
  -o jsonpath='{.data.admin-password}' | base64 -d
# user: admin
```

Two ways to reach the UI:

1. **Tailscale (durable, no port-forward — preferred)**. The Grafana
   service carries `tailscale.com/expose: "true"` annotations
   (cf. `flux/infra/prod/prometheus.yaml`). The Tailscale operator
   (Phase C, below) joins it to the tailnet as `http://grafana`.
   Prometheus is exposed the same way at `http://prometheus`. Both
   are visible only to tailnet members.
2. **Local port-forward (no Tailscale needed)**:
   ```bash
   kubectl -n monitoring port-forward svc/kube-prometheus-stack-grafana 3030:80
   # http://127.0.0.1:3030 (3000 is left free for Nuxt dev)
   ```

The chart auto-loads useful dashboards (Kubernetes / Compute
Resources, Node Exporter / Nodes, NGINX Ingress Controller). For
canary visibility add the Flagger dashboard manually
(`grafana.com/dashboards/14672`).

### B.6 What happens if Prometheus is down

Flagger marks every metric check as failed and aborts every canary
after `threshold` consecutive failures (5 by default). Net effect:
no progressive delivery, but `frontend-primary` keeps serving the
last known-good version because Flagger never promotes a canary on
failure. The runbook entry to recover is:

```bash
kubectl -n monitoring get pods | grep prometheus
kubectl -n monitoring logs prometheus-kube-prometheus-stack-0 -c prometheus --tail=50
# Usually: storage pressure on local-path PVC, or a label conflict
# after an upstream chart bump. Bumping the HelmRelease tag and
# letting Flux reconcile fixes most cases.
```

## Phase C — Tailscale service exposure

Per thesis §3.7, internal services should be reachable from the
tailnet but never from the public web. We use the official Tailscale
Kubernetes operator: annotate a Service with `tailscale.com/expose:
"true"` and the operator spawns a small proxy Pod that joins the
tailnet under its own MagicDNS hostname.

### C.1 One-time admin-console steps

You must do this once, in browser, before Flux can bring up the
operator:

1. Open <https://login.tailscale.com/admin/acls/file>. Make sure the
   ACL policy contains:
   ```jsonc
   {
     "tagOwners": {
       "tag:k8s-operator": ["autogroup:admin"],
       "tag:k8s":          ["tag:k8s-operator"]
     },
     // ...rest of your policy unchanged
   }
   ```
   `tag:k8s-operator` lets the operator authenticate; `tag:k8s` is
   what every per-Service proxy gets tagged with, owned by the
   operator (this is what lets the operator rotate auth keys for
   those proxies without your intervention).

2. Open <https://login.tailscale.com/admin/settings/oauth>. Click
   **Generate OAuth client**:
   - Description: `dp-reality k8s operator`
   - Scopes: `Devices: Core (Write)`, `Auth Keys (Write)`
   - Tags: `tag:k8s-operator`

   Copy the client ID and client secret it shows ONCE.

### C.2 Encrypt the credentials into Git

From the workspace root with the SOPS age key present:

```bash
# Decrypt the placeholder
sops flux/infra/prod/secrets/tailscale-operator-oauth.yaml
# Replace PLACEHOLDER_CLIENT_ID / PLACEHOLDER_CLIENT_SECRET with the
# real values, save & exit. The file is re-encrypted on close.
```

Commit the encrypted file. Flux re-applies the Secret, and the
operator pod restarts when it sees the new credentials.

### C.3 Verify the operator is happy

```bash
kubectl -n tailscale get pods       # operator + per-service proxy pods
sudo tailscale status               # `grafana`, `prometheus` appear as
                                     # devices in your tailnet
```

From any tailnet device:

```bash
ping -c1 grafana
curl -sI http://grafana             # 302 redirect to login is success
curl -sI http://prometheus/-/ready  # 200 is success
```

### C.4 Exposing a new Service

Two annotations on the Service do everything:

```yaml
metadata:
  annotations:
    tailscale.com/expose:   "true"
    tailscale.com/hostname: "my-internal-thing"
```

No NodePort, no Ingress, no firewall change. The Service is
unreachable from anywhere except the tailnet.

### C.5 Removing an exposure

Drop the annotations and Flux reconciles the chart values — the proxy
Pod is deleted and the Tailscale device disappears from the admin
console within a minute.

## Phase D — Centralised logs (Loki + Promtail)

Loki sits next to Prometheus in the observability story: Prometheus
answers "what was happening" (metrics, rates, success ratios), Loki
answers "what did it say" (the actual log line). The two queries are
linked in Grafana via shared labels (`namespace`, `pod`, `container`),
so you can pivot from a Prometheus alert to the offending pod's
log lines in one click.

### D.1 What gets installed

`flux/infra/prod/loki.yaml` deploys three things:

- `loki` (HelmRelease) — single-binary Loki + 10 GiB filesystem PVC,
  7-day retention to match Prometheus.
- `promtail` (HelmRelease) — DaemonSet that tails every container's
  stdout/stderr and ships to Loki with Kubernetes labels attached.
- `loki-datasource` (ConfigMap, labelled `grafana_datasource: "1"`) —
  Grafana's sidecar auto-discovers it across all namespaces (cf.
  `prometheus.yaml`'s `sidecar.datasources.searchNamespace=ALL`) and
  reloads without restarting Grafana.

### D.2 Querying logs

In Grafana → **Explore** → switch the datasource dropdown to **Loki**.
Useful starting queries (LogQL):

```logql
{namespace="dp-reality"}
{namespace="dp-reality", container="frontend"} |= "error"
{namespace="dp-reality"} | json | request_id="abc-123"
sum by (container) (rate({namespace="dp-reality"} |~ "(?i)error" [1m]))
```

Grafana's *Split view* button lets you put a Prometheus chart and a
Loki query side-by-side — the timestamp scroll is synchronised, so
you can click a request-rate spike on the metrics side and jump to
the matching log window on the right.

### D.3 Capacity & retention

- 10 GiB PVC, 7-day retention, no replication (single-binary).
- Current cluster log volume ≈ a few MB/day — months of headroom.
- When the RPi5 joins, Promtail's DaemonSet will pick up automatically
  (no config change). Loki itself stays single-replica on the
  Minisforum's storage.

### D.4 Failure modes

- **Loki down**: Promtail buffers in memory + on local disk per node
  for a few minutes. Beyond that, log lines are dropped — Promtail
  prefers losing logs over crashing the node.
- **PVC fills up**: Loki's compactor enforces 7d retention, but if
  log volume spikes the PVC can fill before compaction runs. Watch
  `loki_ingester_disk_usage` in Prometheus, bump `singleBinary.
  persistence.size` in the HelmRelease when needed.

## Phase 3 (deferred) — CronJobs

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
