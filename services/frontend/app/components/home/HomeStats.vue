<script setup lang="ts">
import type { Stat } from '~~/shared/types'

interface StatsPayload {
  total_listings: number
  new_last_24h: number
  active_bots: number
  unread_matches: number
}

const { data } = await useFetch<StatsPayload>('/api/stats', {
  default: () => ({
    total_listings: 0,
    new_last_24h: 0,
    active_bots: 0,
    unread_matches: 0
  })
})

const stats = computed<Stat[]>(() => [
  {
    title: 'Total listings',
    icon: 'i-lucide-database',
    value: data.value.total_listings.toLocaleString()
  },
  {
    title: 'New (24h)',
    icon: 'i-lucide-sparkles',
    value: data.value.new_last_24h.toLocaleString()
  },
  {
    title: 'Active bots',
    icon: 'i-lucide-bot',
    value: data.value.active_bots.toLocaleString()
  },
  {
    title: 'Unread matches',
    icon: 'i-lucide-inbox',
    value: data.value.unread_matches.toLocaleString()
  }
])

const TILE_TO: Record<string, string> = {
  'Total listings': '/inbox',
  'New (24h)': '/inbox',
  'Active bots': '/bots',
  'Unread matches': '/inbox?filter=unread'
}
</script>

<template>
  <UPageGrid class="lg:grid-cols-4 gap-4 sm:gap-6 lg:gap-px">
    <UPageCard
      v-for="(stat, index) in stats"
      :key="index"
      :icon="stat.icon"
      :title="stat.title"
      :to="TILE_TO[stat.title]"
      variant="subtle"
      :ui="{
        container: 'gap-y-1.5',
        wrapper: 'items-start',
        leading: 'p-2.5 rounded-full bg-primary/10 ring ring-inset ring-primary/25 flex-col',
        title: 'font-normal text-muted text-xs uppercase'
      }"
      class="lg:rounded-none first:rounded-l-lg last:rounded-r-lg hover:z-1"
    >
      <div class="flex items-center gap-2">
        <span class="text-2xl font-semibold text-highlighted">
          {{ stat.value }}
        </span>
      </div>
    </UPageCard>
  </UPageGrid>
</template>
