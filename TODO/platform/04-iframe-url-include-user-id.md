# platform/04 — Iframe URL must carry both `user_id` and `config_id`

## Goal
Make the iframe URL match the thesis contract: the BFF appends BOTH
`user_id` and `config_id` when building the iframe `src`, the same
way the proxy already injects `user_id` on every subsequent forwarded
request. Today the iframe URL only carries `config_id` and `user_id`
is supplied solely by the proxy — that's an undocumented asymmetry
the thesis does not allow.

## Thesis references
- `03-architecture-design.tex` §3.3.4 Bot Service Contract, required
  obligation #2 (≈ line 358):
  > "The BFF embeds it as an iframe with
  > `?user_id=...&config_id=...` appended"
- `03-architecture-design.tex` §3.2.4.4 User-Driven Configuration
  (≈ line 152):
  > "the bot's iframe, embedded through the reverse proxy and
  > carrying `user_id` and `config_id` as its only context"
- `04-implementation.tex` §4.1 Application Routes (≈ line 30):
  > "`/modules/<bot_id>/<configure_url>?user_id=<uid>&config_id=<cid>`"

## Current state
- `services/frontend/app/components/bots/BotConfigDialog.vue` builds
  the iframe `src` with only `config_id`:
  ```
  const sp = new URLSearchParams({ config_id: minted.value.config_id })
  ```
- `services/frontend/server/utils/module-proxy.ts` strips any
  `user_id` arriving on the incoming request and re-sets it from the
  authenticated session. So the bot always receives the
  session-authoritative `user_id` regardless of what's in the URL —
  but the iframe URL itself does not include it.

The asymmetry is invisible to the bot service (it sees both) but
visible to the thesis reader (who is told both are appended by the
BFF) and to anyone reading the frontend code (who has to follow the
proxy hop to discover where `user_id` comes from).

## Scope
In: change the iframe URL builder to include both. Keep the proxy's
"strip and re-set from session" behaviour unchanged (defense in
depth — the URL value is the initial advertisement; the proxy
remains authoritative for the actual forwarded value).
Out: changing the proxy behaviour. Out: changing the bot service
HTTP API.

## Concrete changes

### 1. Frontend: pass `user_id` into the dialog
The dialog is opened from `pages/store.vue` and `pages/bots/index.vue`.
Both pages already have access to the logged-in user via the standard
`useUserSession()` composable that `nuxt-auth-utils` provides.

Add a `userId` prop (or derive it inside the dialog with
`useUserSession()`).

### 2. `BotConfigDialog.vue` — append `user_id` to the iframe URL
Update the `iframeSrc` computed:
```ts
const { user } = useUserSession()

const iframeSrc = computed(() => {
  if (!minted.value || !user.value?.id) return ''
  const sp = new URLSearchParams({
    user_id: user.value.id,
    config_id: minted.value.config_id,
  })
  const path = props.registry.configure_url || '/configure'
  const slash = path.startsWith('/') ? '' : '/'
  return `/modules/${minted.value.bot_id}${slash}${path.replace(/^\/+/, '')}?${sp.toString()}`
})
```

The proxy will read this incoming `user_id`, drop it, and re-set
the session value (already correct behaviour in
`module-proxy.ts`). So a tampered iframe URL cannot escalate
into another user's bot — the URL value is purely cosmetic /
declarative.

### 3. Document the defense-in-depth posture
Add a one-paragraph comment at the top of `module-proxy.ts`
explaining: *"the iframe URL advertises `user_id` per the thesis
contract, but this proxy treats any incoming `user_id` as
untrusted and overwrites it with the session-derived value on
every forwarded request."* The current comment block already
explains the latter; just connect the two so a future reader does
not see the dialog and proxy as contradicting each other.

### 4. (Optional, only if security/01 lands first) cookie-only path
If `nuxt-auth-utils` is replaced by the Mongo-backed session
middleware from `security/01`, `useUserSession()` is still the right
client-side accessor — keep it.

## Acceptance criteria
- Opening the bot-creation wizard produces an iframe URL of the form
  `/modules/<bot_id>/configure?user_id=<hex>&config_id=<hex>` in the
  DOM (verifiable via `Inspect` on the `<iframe>` element).
- The bot service log shows `user_id` arriving on every request
  (including the initial GET) — unchanged behaviour, the value
  still comes from the session via the proxy's override.
- A malicious user editing the iframe URL in DevTools to substitute
  someone else's `user_id` still cannot read or write that user's
  config row, because the proxy override + the bot's `user_id`
  comparison in `GET/POST /configs/:config_id` are unchanged.

## Open questions
None — the thesis is unambiguous, the proxy already provides the
security guarantee, this is a 3-line cosmetic alignment.
