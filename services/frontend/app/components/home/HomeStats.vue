<script setup lang="ts">
import type { Stat } from '~~/shared/types'

interface StatsPayload {
  active_bots: number
  paused_bots: number
  total_matches: number
  unread_matches: number
}

const { data } = await useFetch<StatsPayload>('/api/stats', {
  default: () => ({
    active_bots: 0,
    paused_bots: 0,
    total_matches: 0,
    unread_matches: 0
  })
})

const stats = computed<Stat[]>(() => [
  {
    title: 'Active bots',
    icon: 'i-lucide-bot',
    value: data.value.active_bots.toLocaleString()
  },
  {
    title: 'Paused bots',
    icon: 'i-lucide-pause',
    value: data.value.paused_bots.toLocaleString()
  },
  {
    title: 'Total matches',
    icon: 'i-lucide-database',
    value: data.value.total_matches.toLocaleString()
  },
  {
    title: 'Unread matches',
    icon: 'i-lucide-inbox',
    value: data.value.unread_matches.toLocaleString()
  }
])

const TILE_TO: Record<string, string> = {
  'Active bots': '/bots',
  'Paused bots': '/bots',
  'Total matches': '/inbox',
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
