# bots/01 — Implement `bot-bezrealitky` reference module

## Goal
Ship the third bot service described in thesis chapter 4 §4.3.2. It
must satisfy the platform's module contract (thesis §3.3.4) so the
BFF + email notifier need no changes when it comes online.

## Thesis references
- `04-implementation.tex` §4.3.2 `subsec:impl-bot-bezrealitky`:
  > "Bezrealitky is a peer-to-peer real-estate platform […]. The bot
  > uses a hybrid acquisition strategy: the internal endpoints supply
  > paginated listing summaries (URLs, basic metadata), and
  > per-listing detail (full description, photos, contact
  > information) is fetched from the individual listing pages when
  > the summary alone is insufficient for the card. Anti-bot
  > enforcement is stronger than on the other portals: the bot
  > applies request throttling and rotates a small set of header
  > profiles to keep below the observed thresholds."
- `03-architecture-design.tex` §3.3.4 Bot Service Contract (the
  required-five and optional surfaces).
- `03-architecture-design.tex` §3.4.1 listings_<bot> base schema +
  source-specific tail.

## Current state
Service does not exist. The reference modules are
`services/bot-bazos/` (Python/FastAPI) and `services/bot-sreality/`
(TypeScript/NestJS). Both implement the same contract through
different language stacks.

## Scope
In: a new long-running service `bot-bezrealitky` with scraper,
matcher, notification renderer, welcome flow, HTTP API (configure
page + helper endpoints + configs read/write), module registry
self-registration, and platform-mandated indexes.
Out: BFF changes (the registry-driven discovery already handles new
modules transparently). Out: K3s manifests (covered in
`deployment/01-k3s-manifests.md`).

## Language and shape
**Pick Python/FastAPI**, mirroring `bot-bazos` rather than
`bot-sreality`. Rationale:
- Bezrealitky requires per-listing detail fetches and header-profile
  rotation; the python `httpx` ecosystem already used by `bot-bazos`
  is well-suited.
- The thesis explicitly calls out the polyglot-stack point in
  §3.3.3 "Per-source matcher embedded in the bot service" — having
  two of three bots in Python and one in TypeScript is a deliberate
  demonstration of language independence.

## Concrete changes

### 1. Project skeleton
`services/bot-bezrealitky/` mirroring `services/bot-bazos/`:
- `Dockerfile` (identical to bazos modulo path).
- `requirements.txt` (copy from bazos; add `tenacity` for retry; add
  `random` from stdlib — already there; no new deps unless needed).
- `src/__init__.py`
- `src/main.py` — entrypoint identical to bazos pattern.
- `src/config.py` — settings with `service_id="bot-bezrealitky"`,
  `display_name="Bezrealitky"`, `description="P2P Czech real-estate
   portal. Direct owner↔buyer/tenant. Hybrid JSON+HTML scraper."`,
  `category="real-estate"`,
  `base_url="http://bot-bezrealitky:8000"`,
  `configure_url="/configure"`,
  `config_collection="bezrealitky_config"`,
  `scrape_interval_minutes=10`.
  Add `scrape_throttle_seconds_between_pages: int = 2` (anti-bot
  throttle), and `header_profiles: list[dict] = [<3 profiles>]`.
- `src/models.py` — `Listing`, `BotConfig`, `StoredBotConfig`. Base
  schema same as bazos (`title`, `property_type`, `disposition`,
  `price`, `price_type`, `city`, `district`, `source_url`,
  `source_id`). Source-specific tail: `description`, `surface_m2`,
  `energy_class`, `offer_type` (`sale`/`rent`),
  `photos: list[str]`.
- `src/scraper.py` — hybrid: list endpoint
  (`https://api.bezrealitky.cz/graphql` or whatever the current
  internal JSON endpoint is; investigate via the public site's
  network traffic). For each listing the list endpoint cannot fully
  describe (typically all of them — list responses are summaries),
  fetch the detail page. Implement:
  - `header_profile_iter` — yields one of N user-agent + accept-lang
    pairs round-robin per request.
  - `_sleep_throttle()` between successive page fetches.
  - `tenacity`-wrapped retry with exponential backoff on 5xx / network
    error.
- `src/matcher.py` — fields aligned with `BotConfig`: `offer_type`,
  `property_type`, `price_min`, `price_max`, `city_contains`,
  `disposition_in: list[str]`, `surface_min`, `surface_max`,
  `title_keywords`.
- `src/notifications.py` — `render_card(listing)` returning a
  600px-max-width inline-styled HTML card consistent with the
  shared style guide (see `services/bot-bazos/src/notifications.py`
  and `services/bot-sreality/src/notification-renderer.service.ts`).
  `build_notification(...)` per the platform schema, with
  `source_ref = f"bezrealitky:{listing.source_id}"`.
- `src/welcome.py` — same pattern as bazos: in-process match count
  against current listings, render welcome card, publish on
  `notify.bot.welcome`.
- `src/api.py` — `GET /healthz`, `GET /configure` (HTML),
  `POST /parse-url` (Bezrealitky search-URL → partial config),
  `GET /configs/{config_id}`, `POST /configs/{config_id}`. Same
  identity-check pattern as bazos (compare `user_id` against the
  proxy-injected query value).
- `src/publisher.py` — copy-paste from bazos (`notify.bot.processed`,
  `notify.bot.welcome` fanout exchanges).
- `src/repository.py` — same shape as bazos with collection names
  swapped:
  - `LISTINGS_COLLECTION = "listings_bezrealitky"`
  - `CONFIG_COLLECTION = "bezrealitky_config"`
  - declared in the platform-mandated unique index on
    `(user_id, bot_id, source_ref)` over `notifications`.
- `src/cycle.py` — identical pattern (fetch → upsert → match per
  user → publish one `notify.bot.processed` per user).
- `src/templates/configure.html` — minimal form, same look-and-feel
  as `bot-bazos/templates/configure.html`. URL parser button must
  POST to `/modules/bot-bezrealitky/parse-url`.

### 2. Throttling design
Bezrealitky is the only bot where the thesis explicitly calls out
anti-bot enforcement. The thesis grants this bot the right to opt
into stronger countermeasures (NFR-01-B). Implement:
- Per-page sleep `scrape_throttle_seconds_between_pages` (default 2).
- Per-cycle sleep of 30 minutes if a 429 or 403 is observed; on the
  next cycle the bot resumes with a fresh header profile.
- Hard cycle abort + `_consecutive_failures` increment on 5xx burst,
  same as bazos. Three consecutive failures → process exit (let the
  orchestrator restart on a different node if topology allows; the
  thesis allows this in §3.3.1).

### 3. URL parser
`POST /parse-url` accepts a bezrealitky.cz search URL and returns
`{ok: true, parsed: {...}}` or `{ok: false, reason: "..."}`. Map:
- `/nabidka/prodej/byt/{velikost}/{lokalita}` and the
  `/pronajem/...` mirror to `offer_type` + `property_type` +
  `disposition_in` + `city_contains`.
- `cena[od]`, `cena[do]` query params → `price_min`, `price_max`.

### 4. Compose plumbing
Add the service to `compose.yml` and `compose.dev.yml`:
- Same env shape as bot-bazos.
- `MONGODB_URI` becomes `MONGODB_URI_BOT_BEZREALITKY` (per
  `platform/02-mongo-credential-separation.md`).
- Add to `provision-mongo-users.mjs`.

### 5. Multi-arch image
The Dockerfile must build for both x86_64 and ARM64. Bezrealitky is
the heaviest of the three bots (header rotation, throttle, hybrid
fetch) — the thesis (§3.4 "Bot Service Placement") explicitly notes
heavier bots can be pinned to the x86_64 node via nodeAffinity. The
multi-arch image build itself lives in
`deployment/05-multi-arch-ci-pipeline.md`; here just ensure the
Dockerfile uses no x86-specific instructions.

## Acceptance criteria
- A fresh boot upserts one `module_registry` row with
  `bot_id: "bot-bezrealitky"`.
- The /store page picks it up automatically (existing BFF code path).
- The two-step wizard creates a configuration; the `bezrealitky_config`
  row appears; the welcome email arrives with a Bezrealitky-flavoured
  card.
- A scrape cycle produces listings in `listings_bezrealitky`, matches
  them per active config, writes rows in `notifications` with
  `source_ref = "bezrealitky:<id>"`, and emits exactly one
  `notify.bot.processed` per affected user per cycle.
- Pausing / resuming / deleting works through the existing BFF flows
  without bot-side code (lifecycle-is-BFF-owned per §3.3.4).

## Open questions
- **Bezrealitky internal API stability.** The endpoint URL and shape
  must be discovered at implementation time by inspecting
  bezrealitky.cz network traffic; whatever is current as of execution
  date wins. Document the exact URL + payload shape in a comment at
  the top of `scraper.py`.
- **Photo URLs in cards.** The thesis card style guide does not
  mandate images; including a single thumbnail is consistent with
  the existing sreality card. Default to including one image when the
  detail fetch returned at least one and the sanitiser allows `<img>`
  (it does).
