<script setup lang="ts">
import type { ListingsMapResponse } from '~~/server/api/stats/listings-heatmap.get'

const DISPOSITIONS = ['1+kk', '1+1', '2+kk', '2+1', '3+kk', '3+1', '4+kk', '4+1', '5+kk', '5+1'] as const
type Disposition = typeof DISPOSITIONS[number]

const ALL = 'all' as const
type DispositionFilter = Disposition | typeof ALL

const dispositionItems: Array<{ label: string, value: DispositionFilter }> = [
  { label: 'All apartments + houses', value: ALL },
  ...DISPOSITIONS.map(d => ({ label: d, value: d }))
]
const priceTypeItems = [
  { label: 'For sale', value: 'sale' },
  { label: 'For rent', value: 'rent' }
]

const disposition = ref<DispositionFilter>(ALL)
const priceType = ref<'sale' | 'rent'>('sale')

const { data, status } = useFetch<ListingsMapResponse>('/api/stats/listings-heatmap', {
  query: computed(() => ({
    ...(disposition.value !== ALL ? { disposition: disposition.value } : {}),
    price_type: priceType.value
  })),
  server: false,
  lazy: true,
  default: (): ListingsMapResponse => ({
    listings: [],
    breakpoints: [0, 0, 0, 0],
    median: 0,
    count: 0
  })
})

const formatPrice = (n: number) => {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M Kč`
  if (n >= 1_000) return `${Math.round(n / 1_000)} k Kč`
  return `${n} Kč`
}

const BIN_COLORS = ['#2563eb', '#06b6d4', '#9ca3af', '#f59e0b', '#ef4444'] as const
const BIN_LABELS = ['Cheapest 20%', 'Below median', 'Median', 'Above median', 'Top 20%'] as const
</script>

<template>
  <UCard :ui="{ root: 'overflow-visible', body: 'px-0! pt-0! pb-0!' }">
    <template #header>
      <div class="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p class="text-xs text-muted uppercase mb-1.5">
            Listings on the map
          </p>
          <p class="text-3xl text-highlighted font-semibold">
            {{ (data?.count ?? 0).toLocaleString() }}
            <span class="text-sm text-muted font-normal ml-1">listings</span>
          </p>
          <p class="text-xs text-muted mt-1">
            Median price
            <span class="text-default font-medium">{{ formatPrice(data?.median ?? 0) }}</span>
            <span class="ml-2 text-muted">click a marker to open the ad</span>
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <USelect
            v-model="priceType"
            :items="priceTypeItems"
            value-key="value"
            variant="ghost"
            class="data-[state=open]:bg-elevated min-w-32"
          />
          <USelect
            v-model="disposition"
            :items="dispositionItems"
            value-key="value"
            variant="ghost"
            class="data-[state=open]:bg-elevated min-w-40"
          />
        </div>
      </div>
    </template>

    <div class="relative">
      <ClientOnly>
        <LazyHomeHeatmapMap
          :data="data ?? { listings: [], breakpoints: [0, 0, 0, 0], median: 0, count: 0 }"
          :bin-colors="BIN_COLORS"
        />
        <template #fallback>
          <div class="map-fallback h-112 w-full" />
        </template>
      </ClientOnly>

      <div
        v-if="status === 'pending'"
        class="absolute inset-0 grid place-items-center bg-default/60 backdrop-blur-sm pointer-events-none"
      >
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary" />
      </div>

      <div class="legend absolute right-3 bottom-3 z-400 flex flex-col gap-1 px-3 py-2 rounded-md bg-elevated/90 backdrop-blur-sm ring ring-default text-xs text-muted">
        <span class="text-muted text-[10px] uppercase tracking-wide">vs. median</span>
        <div class="flex items-center gap-2">
          <span
            v-for="(c, i) in BIN_COLORS"
            :key="c"
            class="size-3 rounded-full"
            :style="{ background: c }"
            :title="BIN_LABELS[i]"
          />
        </div>
        <div class="flex items-center justify-between text-[10px] text-muted">
          <span>Cheaper</span>
          <span>Pricier</span>
        </div>
      </div>
    </div>
  </UCard>
</template>

<style scoped>
.map-fallback {
  background: var(--ui-bg);
  border-radius: 0 0 var(--ui-radius) var(--ui-radius);
}
</style>
