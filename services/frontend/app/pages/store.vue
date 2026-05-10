<script setup lang="ts">
import type { ModuleRegistryEntry } from '~~/shared/types'

useHead({ title: 'Bot store' })

const route = useRoute()
const router = useRouter()
const toast = useToast()

// Source of truth for what services are available right now. Each row
// is published by a running bot service via self-registration; the
// per-card "Add bot" button falls back to a 404 toast if the BFF
// cannot route to the service when the wizard's Next is pressed.
const { data: registry, status, refresh } = await useFetch<{ items: ModuleRegistryEntry[] }>(
  '/api/modules/registry',
  { default: () => ({ items: [] }), lazy: true }
)

const items = computed(() => registry.value?.items ?? [])

// Free-form filter over display name / description / bot_id so the
// user can search even when there are dozens of services.
const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return items.value
  return items.value.filter(m =>
    m.display_name.toLowerCase().includes(q)
    || m.description.toLowerCase().includes(q)
    || m.bot_id.toLowerCase().includes(q)
    || m.category.toLowerCase().includes(q)
  )
})

// Group by category and sort each group alphabetically. The category
// header itself is human-prettified ("real-estate" → "Real estate").
type Group = { id: string, label: string, items: ModuleRegistryEntry[] }

function prettyCategory(slug: string): string {
  if (!slug) return 'Other'
  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c: string) => c.toUpperCase())
}

const groups = computed<Group[]>(() => {
  const buckets = new Map<string, ModuleRegistryEntry[]>()
  for (const m of filtered.value) {
    const key = m.category || 'other'
    const arr = buckets.get(key) ?? []
    arr.push(m)
    buckets.set(key, arr)
  }
  return [...buckets.entries()]
    .map(([id, arr]) => ({
      id,
      label: prettyCategory(id),
      items: arr.slice().sort((a, b) => a.display_name.localeCompare(b.display_name))
    }))
    .sort((a, b) => {
      // Push the catch-all "Other" group to the end; everything else
      // is alphabetical so the layout is stable as new categories
      // come online.
      if (a.id === 'other') return 1
      if (b.id === 'other') return -1
      return a.label.localeCompare(b.label)
    })
})

function iconFor(botId: string): string {
  if (botId.includes('bazos')) return 'i-lucide-shopping-bag'
  if (botId.includes('sreality')) return 'i-lucide-home'
  return 'i-lucide-plug'
}

// Bot config dialog state. The store page hands the registry entry to
// the wizard; the wizard's Step 1 collects name + email, and the BFF
// is only contacted when the user clicks Next (Step 1 -> Step 2).
const configRegistry = ref<ModuleRegistryEntry | null>(null)

function pick(entry: ModuleRegistryEntry) {
  configRegistry.value = entry
}

function closeConfig() {
  configRegistry.value = null
}

async function onConfigSaved() {
  closeConfig()
  toast.add({ title: 'Bot saved', color: 'success' })
  await router.push('/bots')
}

function onConfigCancelled() {
  closeConfig()
}

// `?install=<bot_id>` deep-links from the dashboard "New bot" button
// directly into the picker action so the redirect feels seamless.
onMounted(() => {
  const want = route.query.install
  if (typeof want === 'string' && want) {
    const entry = (registry.value?.items ?? []).find(e => e.bot_id === want)
    if (entry) pick(entry)
    router.replace({ query: {} })
  }
})

// If the registry was hydrated server-side and a category arrives
// later (e.g. a bot service comes online while the page is open),
// we want the new card to appear without a manual reload.
const pollHandle = ref<ReturnType<typeof setInterval> | null>(null)
onMounted(() => {
  pollHandle.value = setInterval(() => { void refresh() }, 30_000)
})
onBeforeUnmount(() => {
  if (pollHandle.value) clearInterval(pollHandle.value)
})
</script>

<template>
  <UDashboardPanel id="store">
    <template #header>
      <UDashboardNavbar title="Store">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="My bots"
            icon="i-lucide-bot"
            variant="ghost"
            color="neutral"
            to="/bots"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-1.5">
          <h2 class="text-lg font-semibold">
            Pick a service to follow
          </h2>
          <p class="text-sm text-muted">
            Each bot service watches a single source. Add as many as you like —
            you can pause, edit or delete them later from
            <NuxtLink to="/bots" class="underline underline-offset-2 hover:text-primary">
              My bots
            </NuxtLink>.
          </p>
        </div>

        <UInput
          v-model="search"
          class="max-w-sm"
          icon="i-lucide-search"
          placeholder="Search services…"
        />

        <div
          v-if="status === 'pending' && items.length === 0"
          class="text-sm text-muted py-12 text-center"
        >
          Loading installed services…
        </div>

        <div
          v-else-if="items.length === 0"
          class="rounded-md border border-warning bg-warning/5 p-4 text-sm"
        >
          No bot services are running. Start one (e.g. <code>bot-bazos</code>
          or <code>bot-sreality</code>) and refresh this page.
        </div>

        <div
          v-else-if="filtered.length === 0"
          class="text-sm text-muted py-12 text-center"
        >
          No services match "{{ search }}".
        </div>

        <section
          v-for="group in groups"
          :key="group.id"
          class="flex flex-col gap-3"
        >
          <div class="flex items-center gap-2">
            <h3 class="text-sm font-semibold uppercase tracking-wide text-muted">
              {{ group.label }}
            </h3>
            <UBadge variant="subtle" color="neutral" size="sm">
              {{ group.items.length }}
            </UBadge>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div
              v-for="entry in group.items"
              :key="entry.bot_id"
              class="flex flex-col rounded-lg border border-default bg-default p-4 transition hover:border-primary/60"
            >
              <div class="flex items-start gap-3">
                <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                  <UIcon :name="iconFor(entry.bot_id)" class="size-5" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-medium">{{ entry.display_name }}</span>
                    <UBadge
                      variant="subtle"
                      color="neutral"
                      size="sm"
                      class="font-mono text-[10px]"
                    >
                      {{ entry.bot_id }}
                    </UBadge>
                  </div>
                  <p class="text-xs text-muted mt-1 line-clamp-3">
                    {{ entry.description }}
                  </p>
                </div>
              </div>

              <div class="mt-4 flex items-center justify-between gap-2">
                <span class="text-[11px] text-muted font-mono">
                  {{ entry.category }}
                </span>
                <UButton
                  size="sm"
                  icon="i-lucide-plus"
                  label="Add bot"
                  @click="pick(entry)"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      <ClientOnly>
        <BotsBotConfigDialog
          v-if="configRegistry"
          :open="!!configRegistry"
          :bot="null"
          :registry="configRegistry"
          :is-new="true"
          @update:open="(v: boolean) => !v && closeConfig()"
          @saved="onConfigSaved"
          @cancelled="onConfigCancelled"
        />
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
