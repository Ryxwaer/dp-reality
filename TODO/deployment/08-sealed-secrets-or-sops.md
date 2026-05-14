# deployment/08 — Encrypted secrets at rest in Git

## Goal
Honour thesis §3.7.2: the GitOps repository must not contain
plaintext secrets. Each `Secret` resource committed to `k3s/base/`
must be either a `SealedSecret` (Bitnami) or a SOPS-encrypted Secret
(Mozilla SOPS + age). The decryption key lives in-cluster and is
never committed.

## Thesis references
- `03-architecture-design.tex` §3.7.2 Secrets Management:
  > "Database connection strings, RabbitMQ credentials, and the
  > Mailgun API key are stored as Kubernetes Secret resources
  > encrypted at rest by K3s and mounted as environment variables in
  > the consuming pods. Rotation is performed by updating the Secret
  > and restarting the affected pods, and the GitOps repository
  > carries no plaintext secrets: Sealed Secrets or SOPS with age
  > encryption are the planned mechanism for committing encrypted
  > secret material to Git."

## Decision: SOPS + age (over Sealed Secrets)
Reasoning: SOPS + age is supported natively by Flux's
`Kustomization.decryption` setting; it integrates without a separate
controller (Sealed Secrets needs the `sealed-secrets-controller`
running). On a small two-node cluster, fewer controllers is better.
The thesis lets us pick either; pick SOPS+age.

## Concrete changes

### Cluster bootstrap (operator runbook)
Add to `k3s/runbook.md`:
```bash
# One age key per cluster, generated once on the operator's laptop
age-keygen -o age.agekey

# Public half goes into the .sops.yaml at repo root (committed)
# Private half is installed in-cluster as a Secret, NOT committed
kubectl -n flux-system create secret generic sops-age \
  --from-file=age.agekey=age.agekey

shred -u age.agekey   # Optional: keep an offline backup
```

### `.sops.yaml`
Repo root:
```yaml
creation_rules:
  - path_regex: k3s/base/secrets/.*\.yaml$
    encrypted_regex: ^(data|stringData)$
    age: <PUBLIC_AGE_KEY_HERE>
```

### Encrypt every Secret in k3s/base/secrets/
Replace placeholder Secrets created in task 01 with their
SOPS-encrypted counterparts:
```bash
sops --encrypt --in-place k3s/base/secrets/frontend.yaml
sops --encrypt --in-place k3s/base/secrets/bot-bazos.yaml
sops --encrypt --in-place k3s/base/secrets/bot-sreality.yaml
sops --encrypt --in-place k3s/base/secrets/bot-bezrealitky.yaml
sops --encrypt --in-place k3s/base/secrets/email-notifier.yaml
sops --encrypt --in-place k3s/base/secrets/rabbitmq.yaml
sops --encrypt --in-place k3s/base/secrets/mongodb.yaml
```

After encryption, `data:` and `stringData:` fields are replaced with
opaque ciphertext; everything else (metadata, type) stays readable.

### Flux integration
Update `flux/clusters/prod/apps.yaml` (created in task 07):
```yaml
spec:
  decryption:
    provider: sops
    secretRef:
      name: sops-age
```

### Editing workflow (developer)
Document:
```bash
sops k3s/base/secrets/frontend.yaml   # opens decrypted in $EDITOR
# Edit, save, sops auto-re-encrypts on close.
```

### CI
Add a step to `.github/workflows/build-and-push.yml` (or a separate
`secrets-lint.yml`) that fails the build if any file under
`k3s/base/secrets/*.yaml` is NOT SOPS-encrypted. Quick grep for
`sops:` top-level key is sufficient.

## Acceptance criteria
- Every file under `k3s/base/secrets/` is SOPS-encrypted (the file
  contains the `sops:` metadata block).
- Flux successfully decrypts and applies the Secrets — verify with
  `kubectl get secret frontend -n dp-reality -o yaml` showing
  populated `data` values.
- Editing a Secret via `sops` and pushing causes Flux to re-apply
  within the reconciliation interval.
- `git grep -E 'MAIL_SMTP_PASSWORD: [a-zA-Z]'` finds nothing
  plaintext in the committed tree.

## Open questions
- **Key rotation.** Out of scope. Document in the PR that rotation
  requires re-encrypting every Secret with the new public key and
  swapping `sops-age` in-cluster.
- **Operator key backup.** The age private key is the master
  decryption secret. Document a recommendation to back it up to a
  password manager.
