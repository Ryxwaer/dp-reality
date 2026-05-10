<script setup lang="ts">
import { formatTimeAgo } from '@vueuse/core'
import type { NotificationDoc, BotMeta, ModuleRegistryEntry } from '~~/shared/types'

defineEmits<{
  read: []
}>()

const { isNotificationsSlideoverOpen } = useDashboard()

const { data: notifications, refresh } = await useFetch<NotificationDoc[]>(
  '/api/notifications',
  {
    default: () => [],
    query: { filter: 'unread', limit: 50 }
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

const subtitle = computed(() => {
  const serviceLabel = new Map<string, string>()
  for (const r of registry.value?.items ?? []) {
    serviceLabel.set(r.bot_id, r.display_name)
  }
  const out = new Map<string, string>()
  for (const b of bots.value) {
    out.set(b.config_id, `${serviceLabel.get(b.bot_id) ?? b.bot_id} · ${b.name}`)
  }
  return out
})

watch(isNotificationsSlideoverOpen, (open) => {
  if (open) refresh()
})
</script>

<template>
  <USlideover
    v-model:open="isNotificationsSlideoverOpen"
    title="Unread matches"
  >
    <template #body>
      <div v-if="notifications.length" class="flex flex-col">
        <NuxtLink
          v-for="notification in notifications"
          :key="notification.id"
          :to="`/inbox?id=${notification.id}`"
          class="px-3 py-2.5 rounded-md hover:bg-elevated/50 flex items-start gap-3 relative -mx-3 first:-mt-3"
        >
          <UChip color="error" :show="notification.unread" inset>
            <UAvatar
              size="md"
              icon="i-lucide-house"
              :ui="{ root: 'bg-primary/10 text-primary' }"
            />
          </UChip>

          <div class="text-sm flex-1 min-w-0">
            <p class="flex items-center justify-between gap-3">
              <span class="text-highlighted font-medium truncate">
                {{ notification.title }}
              </span>

              <time
                :datetime="notification.created_at"
                class="text-muted text-xs shrink-0"
                v-text="formatTimeAgo(new Date(notification.created_at))"
              />
            </p>

            <p class="text-dimmed truncate">
              {{ subtitle.get(notification.config_id) ?? 'unknown bot' }}
            </p>
          </div>
        </NuxtLink>
      </div>

      <div
        v-else
        class="flex flex-col items-center justify-center gap-2 py-12 text-center"
      >
        <UIcon name="i-lucide-bell-off" class="size-10 text-dimmed" />
        <p class="text-sm text-muted">
          No unread matches right now.
        </p>
      </div>
    </template>
  </USlideover>
</template>
