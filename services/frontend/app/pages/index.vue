<script setup lang="ts">
interface Module {
  id: string
  displayName: string
  description: string
  iconUrl: string
  urlPatterns: string[]
}

interface Stat {
  source: string
  count: number
}

interface Listing {
  id: string
  title: string
  price: number | null
  priceType: string
  city: string | null
  source: string
  url: string
  firstSeen: string
}

interface ParsedBot {
  name: string
  cities: string[]
  propertyTypes: string[]
  priceTypes: string[]
  minPrice: number | null
  maxPrice: number | null
  dispositions: string[]
  warnings: string[]
}

const { data: stats, status } = await useFetch('/api/stats', { lazy: true })
const { data: modules } = await useFetch<Module[]>('/api/modules', { lazy: true })

const selectedModule = ref<Module | null>(null)
const showPopup = ref(false)
const popupTab = ref<'overview' | 'config'>('overview')
const pasteUrl = ref('')
const parsedBot = ref<ParsedBot | null>(null)
const parseLoading = ref(false)
const parseError = ref('')
const configSchema = ref<any>(null)
const overview = ref<any>(null)
const botEmail = ref('')
const saveLoading = ref(false)
const saveError = ref('')
const saveSuccess = ref(false)

function openModule(mod: Module) {
  selectedModule.value = mod
  showPopup.value = true
  popupTab.value = 'overview'
  parsedBot.value = null
  pasteUrl.value = ''
  parseError.value = ''
  saveError.value = ''
  saveSuccess.value = false
  fetchOverview(mod)
  fetchConfigSchema(mod)
}

function closePopup() {
  showPopup.value = false
  selectedModule.value = null
}

async function fetchOverview(mod: Module) {
  try {
    overview.value = await $fetch(`/api/modules/${mod.id}/overview`)
  } catch { overview.value = null }
}

async function fetchConfigSchema(mod: Module) {
  try {
    configSchema.value = await $fetch(`/api/modules/${mod.id}/config-schema`)
  } catch { configSchema.value = null }
}

async function parseUrl() {
  if (!pasteUrl.value.trim() || !selectedModule.value) return
  parseLoading.value = true
  parseError.value = ''
  parsedBot.value = null
  try {
    parsedBot.value = await $fetch<ParsedBot>(
      `/api/modules/${selectedModule.value.id}/parse-url`,
      { method: 'POST', body: { url: pasteUrl.value.trim() } },
    )
  } catch (e: any) {
    parseError.value = e?.data?.message ?? 'Failed to parse URL'
  } finally {
    parseLoading.value = false
  }
}

async function saveBot() {
  if (!parsedBot.value || !botEmail.value.trim()) return
  saveLoading.value = true
  saveError.value = ''
  saveSuccess.value = false
  try {
    await $fetch('/api/bots', {
      method: 'POST',
      body: {
        email: botEmail.value.trim(),
        bot: parsedBot.value,
      },
    })
    saveSuccess.value = true
  } catch (e: any) {
    saveError.value = e?.data?.message ?? 'Failed to save bot'
  } finally {
    saveLoading.value = false
  }
}

function formatPrice(price: number | null, priceType: string): string {
  if (!price) return '—'
  const formatted = price.toLocaleString('cs-CZ')
  return priceType === 'rent' ? `${formatted} Kč/měs.` : `${formatted} Kč`
}

function sourceBadgeClass(source: string): string {
  const map: Record<string, string> = {
    sreality: 'bg-blue-100 text-blue-700',
    bazos: 'bg-orange-100 text-orange-700',
  }
  return map[source] ?? 'bg-gray-100 text-gray-700'
}

function relativeTime(date: string): string {
  const diff = Date.now() - new Date(date).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
</script>

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
      <p class="text-gray-500 mt-1">Real estate listing aggregation overview</p>
    </div>

    <div v-if="status === 'pending'" class="text-gray-400 text-sm py-8">Loading…</div>

    <template v-else-if="stats">
      <!-- Stats cards -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500">Total Listings</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">{{ stats.totalListings.toLocaleString('cs-CZ') }}</p>
        </div>
        <div v-for="s in stats.bySource" :key="s.source" class="bg-white rounded-xl border border-gray-200 p-5">
          <p class="text-sm text-gray-500 capitalize">{{ s.source }}</p>
          <p class="text-3xl font-bold text-gray-900 mt-1">{{ s.count.toLocaleString('cs-CZ') }}</p>
        </div>
      </div>

      <!-- Bot Modules -->
      <div class="mb-8">
        <h2 class="font-semibold text-gray-900 mb-3">Bot Modules</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            v-for="mod in modules ?? []"
            :key="mod.id"
            class="bg-white rounded-xl border border-gray-200 p-5 text-left hover:border-blue-300 hover:shadow-sm transition-all"
            @click="openModule(mod)"
          >
            <div class="flex items-center gap-3 mb-2">
              <div class="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
                <span class="text-blue-600 text-sm font-bold uppercase">{{ mod.id.slice(0, 2) }}</span>
              </div>
              <span class="font-medium text-gray-900">{{ mod.displayName }}</span>
            </div>
            <p class="text-sm text-gray-500 line-clamp-2">{{ mod.description }}</p>
            <div class="mt-3 flex flex-wrap gap-1">
              <span
                v-for="p in mod.urlPatterns"
                :key="p"
                class="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full"
              >{{ p }}</span>
            </div>
          </button>
        </div>
        <div v-if="!modules?.length" class="text-gray-400 text-sm py-4">
          No modules registered yet. Start the scrapers.
        </div>
      </div>

      <!-- Recent Listings -->
      <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100">
          <h2 class="font-semibold text-gray-900">Recent Listings</h2>
        </div>
        <div class="divide-y divide-gray-100">
          <a
            v-for="listing in stats.recentListings"
            :key="listing.id"
            :href="listing.url"
            target="_blank"
            class="flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <span
              :class="sourceBadgeClass(listing.source)"
              class="mt-0.5 text-xs font-medium px-2 py-0.5 rounded-full capitalize shrink-0"
            >{{ listing.source }}</span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-gray-900 truncate">{{ listing.title }}</p>
              <p class="text-sm text-gray-500 mt-0.5">
                {{ listing.city ?? '—' }}
                <span v-if="listing.price" class="mx-1">·</span>
                <span v-if="listing.price" class="text-green-600 font-medium">{{ formatPrice(listing.price, listing.priceType) }}</span>
              </p>
            </div>
            <span class="text-xs text-gray-400 shrink-0 mt-0.5">{{ relativeTime(listing.firstSeen) }}</span>
          </a>
        </div>
        <div v-if="stats.recentListings.length === 0" class="px-5 py-10 text-center text-gray-400 text-sm">
          No listings yet — scrapers will populate data shortly.
        </div>
      </div>
    </template>

    <!-- Module Popup -->
    <Teleport to="body">
      <div v-if="showPopup && selectedModule" class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" @click.self="closePopup">
        <div class="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                <span class="text-blue-600 text-xs font-bold uppercase">{{ selectedModule.id.slice(0, 2) }}</span>
              </div>
              <span class="font-semibold text-gray-900">{{ selectedModule.displayName }}</span>
            </div>
            <button class="text-gray-400 hover:text-gray-600 text-xl leading-none" @click="closePopup">&times;</button>
          </div>

          <!-- Tabs -->
          <div class="flex border-b border-gray-100 px-6">
            <button
              class="py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors"
              :class="popupTab === 'overview' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
              @click="popupTab = 'overview'"
            >Overview</button>
            <button
              class="py-3 px-4 text-sm font-medium border-b-2 -mb-px transition-colors"
              :class="popupTab === 'config' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'"
              @click="popupTab = 'config'"
            >Create Bot</button>
          </div>

          <!-- Content -->
          <div class="flex-1 overflow-y-auto px-6 py-5">
            <!-- Overview Tab -->
            <div v-if="popupTab === 'overview'">
              <p class="text-sm text-gray-500 mb-4">{{ selectedModule.description }}</p>
              <div v-if="overview" class="grid grid-cols-2 gap-3">
                <div class="bg-gray-50 rounded-lg p-3">
                  <p class="text-xs text-gray-500">Total listings</p>
                  <p class="text-xl font-bold text-gray-900">{{ overview.totalListings }}</p>
                </div>
                <div class="bg-gray-50 rounded-lg p-3">
                  <p class="text-xs text-gray-500">New (24h)</p>
                  <p class="text-xl font-bold text-gray-900">{{ overview.newLast24h }}</p>
                </div>
              </div>
              <div v-else class="text-sm text-gray-400 py-4">Loading overview…</div>
            </div>

            <!-- Config Tab -->
            <div v-if="popupTab === 'config'">
              <div class="mb-4">
                <label class="block text-sm font-medium text-gray-700 mb-1">Paste URL from {{ selectedModule.displayName }}</label>
                <div class="flex gap-2">
                  <input
                    v-model="pasteUrl"
                    type="url"
                    placeholder="https://..."
                    class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    @keydown.enter="parseUrl"
                  />
                  <button
                    :disabled="parseLoading || !pasteUrl.trim()"
                    class="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    @click="parseUrl"
                  >Parse</button>
                </div>
                <p v-if="parseError" class="text-red-500 text-xs mt-1">{{ parseError }}</p>
              </div>

              <div v-if="parsedBot" class="space-y-3">
                <div v-if="parsedBot.warnings.length" class="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p v-for="w in parsedBot.warnings" :key="w" class="text-xs text-yellow-700">{{ w }}</p>
                </div>

                <div class="bg-gray-50 rounded-lg p-4 space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-sm font-medium text-gray-900">{{ parsedBot.name }}</span>
                  </div>
                  <div class="text-sm text-gray-600 space-y-1">
                    <p v-if="parsedBot.cities.length"><span class="text-gray-400">Cities:</span> {{ parsedBot.cities.join(', ') }}</p>
                    <p v-if="parsedBot.propertyTypes.length"><span class="text-gray-400">Type:</span> {{ parsedBot.propertyTypes.join(', ') }}</p>
                    <p v-if="parsedBot.priceTypes.length"><span class="text-gray-400">Transaction:</span> {{ parsedBot.priceTypes.join(', ') }}</p>
                    <p v-if="parsedBot.dispositions.length"><span class="text-gray-400">Disposition:</span> {{ parsedBot.dispositions.join(', ') }}</p>
                    <p v-if="parsedBot.minPrice || parsedBot.maxPrice">
                      <span class="text-gray-400">Price:</span>
                      {{ parsedBot.minPrice?.toLocaleString('cs-CZ') ?? '—' }}
                      –
                      {{ parsedBot.maxPrice?.toLocaleString('cs-CZ') ?? '—' }} Kč
                    </p>
                  </div>
                </div>

                <div class="mt-3">
                  <label class="block text-sm font-medium text-gray-700 mb-1">Your email</label>
                  <input
                    v-model="botEmail"
                    type="email"
                    placeholder="you@example.com"
                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <p v-if="saveError" class="text-red-500 text-xs mt-1">{{ saveError }}</p>

                <div v-if="saveSuccess" class="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
                  <p class="text-sm text-green-700 font-medium">Bot saved. You will receive notifications at {{ botEmail }}.</p>
                </div>

                <button
                  v-if="!saveSuccess"
                  :disabled="saveLoading || !botEmail.trim()"
                  class="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-2"
                  @click="saveBot"
                >
                  {{ saveLoading ? 'Saving…' : 'Save Bot Configuration' }}
                </button>
              </div>

              <div v-else-if="!parseLoading" class="text-sm text-gray-400 py-4 text-center">
                Paste a search URL from {{ selectedModule.displayName }} to auto-fill the bot configuration.
              </div>

              <div v-if="parseLoading" class="text-sm text-gray-400 py-4 text-center">Parsing…</div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
