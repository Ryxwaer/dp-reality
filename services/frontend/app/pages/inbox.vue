<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { breakpointsTailwind } from '@vueuse/core'
import type { NotificationDoc } from '~~/shared/types'

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

const filteredNotifications = computed(() => {
  if (selectedTab.value === 'unread') {
    return notifications.value.filter(n => n.unread)
  }
  return notifications.value
})

const selected = ref<NotificationDoc | null>(null)

const isPanelOpen = computed({
  get() {
    return !!selected.value
  },
  set(value: boolean) {
    if (!value) selected.value = null
  }
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
      @select="onSelect"
    />
  </UDashboardPanel>

  <InboxMail
    v-if="selected"
    :notification="selected"
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
          @close="selected = null"
        />
      </template>
    </USlideover>
  </ClientOnly>
</template>
