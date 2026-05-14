# deployment/03 — MongoDB replica set across the two cluster nodes

## Goal
Deploy a two-member MongoDB replica set: primary on the Minisforum
(x86_64) and secondary on the RPi5 (ARM64). Driver-side
`readPreference=nearest` lets Czechia-resident bot services serve
reads locally; writes still cross the Tailscale link.

## Thesis references
- `03-architecture-design.tex` §3.4 "Replication and Sharding
  Strategy":
  > "The deployment uses a MongoDB replica set without sharding. […]
  > the primary resides on the x86_64 server in Slovakia, and a
  > secondary runs on the Raspberry Pi 5 in Czechia. […] driver-level
  > `readPreference=nearest` only redirects reads, and the scrape
  > pipeline is write-dominated, so the secondary does not materially
  > reduce per-cycle latency for Czechia-resident bots; its role is
  > geographic data redundancy on a separate failure domain."

## Current state
- No Mongo manifests in `k3s/`.
- The app reads `MONGODB_URI` (or per-service URIs after platform/02)
  from env; today it points at an external Mongo instance.

## Scope
In: a StatefulSet-based two-node replica set inside the cluster,
PersistentVolumeClaims for storage on each node, a one-shot
`Job` that runs `rs.initiate()` against the freshly-booted primary.
Out: arbiter / quorum (thesis §3.2.3 Future Scaling: arbiter is
explicitly deferred to a third node that does not exist in this
cluster — call this out in the §3.4 limitation note).

## Concrete changes

### Directory
`k3s/base/mongodb/`:
- `statefulset.yaml`
- `service.yaml` (headless service `mongodb` + a regular ClusterIP
  `mongodb-primary` for write-only callers if needed; usually the
  driver uses the headless name)
- `init-replica-set-job.yaml`
- `pvc-storageclass-note.md`

### StatefulSet design
Two pods, `mongodb-0` (primary) and `mongodb-1` (secondary).
Use one StatefulSet with `replicas: 2`, each pod gets its own PVC via
`volumeClaimTemplates`. Node affinity:
- `mongodb-0` → Minisforum via topology-spread + per-pod nodeSelector
  trick is awkward; instead use two **separate StatefulSets**:
  `mongodb-primary` (replicas:1, nodeAffinity amd64) and
  `mongodb-secondary` (replicas:1, nodeAffinity arm64, toleration
  for the edge taint).

Each pod template:
```yaml
containers:
  - name: mongod
    image: mongo:7.0
    args:
      - "--replSet=dp-rs"
      - "--bind_ip_all"
      - "--keyFile=/etc/mongo-keyfile/keyfile"
      - "--auth"
    ports: [{ containerPort: 27017 }]
    volumeMounts:
      - { name: data, mountPath: /data/db }
      - { name: keyfile, mountPath: /etc/mongo-keyfile, readOnly: true }
```

The `keyfile` is a 1024-byte base64 secret committed via SealedSecrets
(task 08) and used by Mongo for internal node-to-node auth in
replica-set mode.

`mongo:7.0` ships official multi-arch images covering amd64+arm64 —
no custom build needed.

### Services
- `mongodb` (headless, `clusterIP: None`) covering both pods.
  Connection string: `mongodb://mongodb-0.mongodb,mongodb-1.mongodb/dp_reality?replicaSet=dp-rs`.
- Drivers should always include `?replicaSet=dp-rs&readPreference=nearest`.
  Update all five service Secrets accordingly.

### One-shot init Job
`init-replica-set-job.yaml` runs once on cluster bootstrap. It exec's
into `mongodb-0` (or runs `mongosh` against it) and issues:
```js
rs.initiate({
  _id: "dp-rs",
  members: [
    { _id: 0, host: "mongodb-0.mongodb:27017", priority: 2 },
    { _id: 1, host: "mongodb-1.mongodb:27017", priority: 1 }
  ]
})
```
Then bootstraps the `root` user and runs the user-provisioning
script from `platform/02` (`provision-mongo-users.mjs`) which is
baked into the `frontend` image or a thin `mongo-tools` image — pick
one and document.

Job restartPolicy: `OnFailure`; backoffLimit: 6. The Job's
PodSpec carries `nodeSelector: kubernetes.io/arch=amd64` so it lands
near the primary.

### Storage
- StorageClass: K3s ships `local-path` (Rancher's local-path
  provisioner). Use it; document the consequence that PV is bound to
  the node and cannot migrate.
- Volume size: 5Gi for primary, 5Gi for secondary. The thesis
  forecasts "a few thousand listings per source per day at most"
  (§3.4 "Replication and Sharding Strategy") — 5Gi covers ~5 years
  of data at that rate.

### Per-service Secret updates
The MONGODB_URI_* values committed in task 01 (placeholders) become
the form documented above. The actual values land in task 08 via
SealedSecrets.

## Acceptance criteria
- `kubectl exec -it mongodb-0 -- mongosh --eval 'rs.status()'` shows
  both members `PRIMARY` and `SECONDARY`.
- All five service URIs include `replicaSet=dp-rs&readPreference=nearest`.
- Killing the secondary pod does not impact the BFF or bot services
  (writes continue, reads degrade to primary).
- Killing the primary pod DOES impact writes (expected per thesis:
  "automatic failover is not provided because the survivor lacks
  majority and accepts only reads until an operator restores a
  quorum.") — verify this matches the thesis-documented behaviour.

## Open questions
- **External Mongo today.** The current deployment uses an external
  Mongo (the README says so explicitly). Switching to in-cluster
  Mongo is a data migration. Plan: `mongodump` from external,
  `mongorestore` into the new replica set before flipping the
  Secrets. Document the runbook step in `k3s/runbook.md`.
- **Backup strategy.** Out of scope. Note as future work.
