<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
const open = ref(false)

// Keep the unread-count in sync with the notifications slideover and inbox.
const { data: unreadCount, refresh: refreshUnread } = await useFetch<{ count: number }>(
  '/api/notifications/count',
  { default: () => ({ count: 0 }) }
)

// Refresh the badge when route changes (covers marking-as-read on inbox nav).
watch(() => route.fullPath, () => {
  refreshUnread()
})

const unreadLabel = computed(() => {
  if (!unreadCount.value?.count) return undefined
  return unreadCount.value.count > 99 ? '99+' : String(unreadCount.value.count)
})

const links = computed(() => [[{
  label: 'Home',
  icon: 'i-lucide-house',
  to: '/',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Inbox',
  icon: 'i-lucide-inbox',
  to: '/inbox',
  badge: unreadLabel.value,
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Bots',
  icon: 'i-lucide-bot',
  to: '/bots',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Modules',
  icon: 'i-lucide-puzzle',
  to: '/modules',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Settings',
  to: '/settings',
  icon: 'i-lucide-settings',
  defaultOpen: true,
  type: 'trigger',
  children: [{
    label: 'General',
    to: '/settings',
    exact: true,
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Notifications',
    to: '/settings/notifications',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Security',
    to: '/settings/security',
    onSelect: () => {
      open.value = false
    }
  }]
}]] satisfies NavigationMenuItem[][])

const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: links.value.flat()
}])
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <TeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />

    <NotificationsSlideover @read="refreshUnread" />
  </UDashboardGroup>
</template>
