# deployment/05 — Multi-architecture CI pipeline

## Goal
Build every service image for both `linux/amd64` (Minisforum) and
`linux/arm64` (Raspberry Pi 5) and publish to GHCR on every push to
the default branch. NFR-03-A in the thesis.

## Thesis references
- `03-architecture-design.tex` §3.1 NFR-03-A:
  > "The project must utilize automated pipelines for building and
  > deploying multi-architecture images (x86\_64 and ARM64)."
- §3.4 "Resource Allocation" (RPi5 = arm64).

## Current state
- No `.github/workflows/` directory.
- Dockerfiles are single-arch (the host platform Docker is running
  on). They use base images that already have arm64 variants
  (`python:3.12-slim`, `node:22-alpine`, `golang:1.23-alpine`,
  `alpine:3.20`) so no Dockerfile rewrites are needed.

## Scope
In: a GitHub Actions workflow that uses `docker/setup-qemu-action`
+ `docker/setup-buildx-action` + `docker/build-push-action` to
produce manifest-list images for both architectures, tagged by
short SHA + `latest`. Out: a non-GitHub CI alternative (the thesis
explicitly says "automated pipelines" — GitHub Actions is the de
facto industry pick and there is no reason to deviate). Out: signing
(cosign) — flag as future work.

## Concrete changes

### Workflow file
`.github/workflows/build-and-push.yml`:

```yaml
name: build-and-push
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  packages: write
jobs:
  build:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service:
          - { name: bot-bazos,       context: ., dockerfile: services/bot-bazos/Dockerfile }
          - { name: bot-sreality,    context: ., dockerfile: services/bot-sreality/Dockerfile }
          - { name: bot-bezrealitky, context: ., dockerfile: services/bot-bezrealitky/Dockerfile }
          - { name: email-notifier,  context: ., dockerfile: services/email-notifier/Dockerfile }
          - { name: frontend,        context: ., dockerfile: services/frontend/Dockerfile }
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ${{ matrix.service.context }}
          file: ${{ matrix.service.dockerfile }}
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ghcr.io/${{ github.repository_owner }}/dp-reality/${{ matrix.service.name }}:latest
            ghcr.io/${{ github.repository_owner }}/dp-reality/${{ matrix.service.name }}:${{ github.sha }}
          cache-from: type=gha,scope=${{ matrix.service.name }}
          cache-to:   type=gha,scope=${{ matrix.service.name }},mode=max
```

### Dockerfile audits
Each Dockerfile needs a brief audit:
- **bot-bazos** (`python:3.12-slim`): `lxml` is a wheel-heavy dep,
  arm64 wheels exist for current versions — pin to a version known to
  publish arm64 wheels. Verify by hand and pin in `requirements.txt`
  if the current floating version doesn't.
- **bot-sreality** (`node:22-alpine`): clean, no arch-specific
  packages.
- **bot-bezrealitky** (Python again): same lxml caveat if it uses it;
  otherwise none.
- **email-notifier** (`golang:1.23-alpine` → `alpine:3.20`): Go is
  natively cross. Just ensure `GOARCH` is not pinned to amd64. The
  current Dockerfile uses `GOOS=linux` only, which is correct.
- **frontend** (`oven/bun:1-alpine` builder → `node:22-alpine` runtime):
  clean. Both images publish arm64 variants. Bun builds the Nitro
  output; node runs it. Watch the bun base image gets picked up on
  arm64 — buildx should select the right manifest automatically.

### Pinning
The CI runs `latest` plus `sha`-tagged images. Production manifests
(task 01) currently reference `:latest`. Once Flux image-automation
is in (task 07), it can pin to the latest SHA tag automatically.
Until then, ops should bump the tag manually in the overlay.

### Documentation
Add a `docs/ci.md` (or extend `README.md`) describing:
- How to build locally for both architectures
  (`docker buildx build --platform linux/amd64,linux/arm64 -t test .`).
- How to pull image-by-sha from GHCR.
- How the GHCR repo visibility is configured (must be public for
  Flux to pull, or Flux needs a pull-secret — flag for task 07).

## Acceptance criteria
- A push to `main` produces five GHCR images, each as a manifest
  list with `amd64` and `arm64` entries (`docker buildx imagetools
  inspect ghcr.io/.../bot-bazos:latest`).
- Pulling on the RPi5 succeeds without `--platform` override.
- Build cache across matrix runs reuses layers (GHA cache scope
  prevents cross-service cache pollution).

## Open questions
- **Repo path on GHCR.** Defaults to
  `ghcr.io/<github_repo_owner>/dp-reality/<service>`. Confirm during
  first CI run; align overlays in task 01 manifests.
- **Cosign signing.** Future work; out of scope here. Document the
  intention in `docs/ci.md`.
