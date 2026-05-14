# Implementation backlog

Concrete tasks bringing the implementation in line with the thesis
(`/home/ryxwaer/Documents/projects/dp-doc/chapters/03-architecture-design.tex`
and `04-implementation.tex`). Every task in this tree is self-contained
and is intended to be executed by an autonomous coding agent without
further user input. Tasks that needed user decisions have already had
those decisions baked in.

## Subfolders

- `platform/` — small, foundational platform fixes that the rest of
  the tree builds on (orphan sweep, real HTML sanitiser, distinct
  MongoDB credentials per service).
- `security/` — auth / session / CSRF gaps called out by thesis §3.7.3
  but missing in code.
- `bots/` — net-new bot service implementations.
- `analytics/` — FR-04-B global market metrics dashboard.
- `deployment/` — full K3s + Flux CD + NetworkPolicies + HPA + MongoDB
  replica set + multi-arch CI migration (thesis §3.4–3.5). This is the
  largest unit of work and is intentionally last so that the smaller
  in-app changes (sessions in Mongo, distinct Mongo creds, etc.) are
  in place before the cluster manifests have to encode them as
  Secrets / ServiceAccounts.
- `thesis-edits/` — places where the thesis needs to be amended rather
  than the code (no `dp-reality` changes; included so the agent does
  NOT silently change code to match these).
- `pending-user-review/` — Group B "extras in code, not in thesis"
  items the user wants to triage manually. The agent must not act on
  these without further instruction.

## Recommended dispatch order

1. `platform/` (small, isolated changes; baseline for everything else)
2. `security/` (depends on the new Mongo credentials from `platform/`)
3. `bots/01-bot-bezrealitky.md` (parallelisable with `analytics/`)
4. `analytics/01-price-evolution-dashboard.md`
5. `deployment/` in numeric order (01 → 09; the K3s manifests are
   the first prerequisite, the rest layer on top)

Group `pending-user-review/` is informational only — do not touch
those files until the user has decided per-item.

## Conventions every task assumes

- Thesis is the source of truth (see `CLAUDE.md`). Anything that
  contradicts the thesis must be flagged in the task's "Open questions"
  block, not silently changed.
- No silent error swallowing. Failures must surface as logs or
  bubble out — the code already follows this and new code must too.
- Everything user-facing is English (existing rule).
- Comments explain non-obvious intent only, never narrate the change.
- MongoDB data may be dropped/migrated freely when a schema changes —
  flag it in the task but do not preserve legacy shape "just in case".
- The thesis path is `/home/ryxwaer/Documents/projects/dp-doc/`. Task
  files cite it by section number; reading the corresponding `.tex`
  before each task is mandatory.
