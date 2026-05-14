<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { NotificationDoc, BotMeta, ModuleRegistryEntry } from '~~/shared/types'

useHead({ title: 'Inbox' })

const tabItems = [
  { label: 'All', value: 'all' },
  { label: 'Unread', value: 'unread' }
]
const selectedTab = ref<'all' | 'unread'>('all')
const toast = useToast()

const { data: notifications, refresh } = await useFetch<NotificationDoc[]>(
  '/api/notifications',
  {
    default: () => [],
    query: { filter: 'all' }
  }
)

const { data: bots } = await useFetch<BotMeta[]>('/api/bots', {
  default: () => [],
  lazy: true
})
const { data: registry } = await useFetch<{ items: ModuleRegistryEntry[] }>(
  '/api/modules/registry',
  { default: () => ({ items: [] }), lazy: true }
)

// Service display names per bot_id (from the registry), config display
// names per config_id (from the user's bots[]). The inbox row carries
// `bot_id` + `config_ids[]` directly, so the per-row badge resolves
// against `serviceLabels` and the per-row bot name lists the matching
// configurations from `configNames`.
const serviceLabels = computed(() => {
  const out = new Map<string, string>()
  for (const r of registry.value?.items ?? []) {
    out.set(r.bot_id, r.display_name)
  }
  return out
})

const configNames = computed(() => {
  const out = new Map<string, string>()
  for (const b of bots.value) {
    out.set(b.config_id, b.name)
  }
  return out
})

const filteredNotifications = computed(() => {
  if (selectedTab.value === 'unread') {
    return notifications.value.filter(n => n.unread)
  }
  return notifications.value
})

const selected = ref<NotificationDoc | null>(null)

const isPanelOpen = computed({
  get() { return !!selected.value },
  set(value: boolean) { if (!value) selected.value = null }
})

watch(filteredNotifications, () => {
  if (!filteredNotifications.value.find(n => n.id === selected.value?.id)) {
    selected.value = null
  }
})

async function onSelect(notification: NotificationDoc) {
  selected.value = notification
  if (!notification.unread) return

  try {
    await $fetch(`/api/notifications/${notification.id}/read`, { method: 'PATCH' })
    const target = notifications.value.find(n => n.id === notification.id)
    if (target) target.unread = false
    notification.unread = false
  } catch {
    toast.add({ title: 'Could not mark as read', color: 'error' })
  }
}

async function onMarkAllRead() {
  try {
    await $fetch('/api/notifications/read-all', { method: 'POST' })
    await refresh()
    toast.add({ title: 'All caught up', color: 'success' })
  } catch {
    toast.add({ title: 'Could not mark all read', color: 'error' })
  }
}

function resolveConfigNames(ids: string[]): string {
  const names = ids
    .map(id => configNames.value.get(id))
    .filter((n): n is string => !!n)
  return names.join(' · ')
}

const selectedLabels = computed(() => {
  if (!selected.value) return { service: '', name: '' }
  return {
    service: serviceLabels.value.get(selected.value.bot_id) ?? selected.value.bot_id,
    name: resolveConfigNames(selected.value.config_ids ?? [])
  }
})

// SSE: subscribe to inbox.refresh hints. We re-fetch on each hint
// (the stream payload is intentionally tiny — it doesn't carry rows).
let source: EventSource | null = null
onMounted(() => {
  if (typeof EventSource === 'undefined') return
  source = new EventSource('/api/sse/inbox')
  source.addEventListener('inbox.refresh', () => { void refresh() })
  source.onerror = () => {
    // Browser will auto-reconnect; we don't surface transient errors.
  }
})
onBeforeUnmount(() => {
  source?.close()
  source = null
})

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('lg')
</script>

<template>
  <UDashboardPanel
    id="inbox-1"
    :default-size="25"
    :min-size="20"
    :max-size="30"
    resizable
  >
    <UDashboardNavbar title="Inbox">
      <template #leading>
        <UDashboardSidebarCollapse />
      </template>
      <template #trailing>
        <UBadge :label="filteredNotifications.length" variant="subtle" />
      </template>

      <template #right>
        <UTooltip text="Mark all read">
          <UButton
            icon="i-lucide-check-check"
            color="neutral"
            variant="ghost"
            :disabled="!notifications.some(n => n.unread)"
            @click="onMarkAllRead"
          />
        </UTooltip>

        <UTabs
          v-model="selectedTab"
          :items="tabItems"
          :content="false"
          size="xs"
        />
      </template>
    </UDashboardNavbar>
    <InboxList
      :notifications="filteredNotifications"
      :selected="selected"
      :service-labels="serviceLabels"
      :config-names="configNames"
      @select="onSelect"
    />
  </UDashboardPanel>

  <InboxMail
    v-if="selected"
    :notification="selected"
    :service-label="selectedLabels.service"
    :bot-name="selectedLabels.name"
    @close="selected = null"
  />
  <div v-else class="hidden lg:flex flex-1 items-center justify-center">
    <UIcon name="i-lucide-inbox" class="size-32 text-dimmed" />
  </div>

  <ClientOnly>
    <USlideover v-if="isMobile" v-model:open="isPanelOpen">
      <template #content>
        <InboxMail
          v-if="selected"
          :notification="selected"
          :service-label="selectedLabels.service"
          :bot-name="selectedLabels.name"
          @close="selected = null"
        />
      </template>
    </USlideover>
  </ClientOnly>
</template>
