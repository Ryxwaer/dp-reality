<script setup lang="ts">
import { format, isToday } from 'date-fns'
import type { NotificationDoc } from '~~/shared/types'

interface BotLabels {
  name: string
  bot_id: string
  serviceLabel: string
}

const props = defineProps<{
  notifications: NotificationDoc[]
  selected: NotificationDoc | null
  botLabels: Map<string, BotLabels>
}>()

const emit = defineEmits<{
  select: [notification: NotificationDoc]
}>()

const refs = ref<Record<string, Element | null>>({})

watch(() => props.selected, (next) => {
  if (!next) return
  const el = refs.value[next.id]
  if (el) el.scrollIntoView({ block: 'nearest' })
})

defineShortcuts({
  arrowdown: () => {
    const index = props.notifications.findIndex(n => n.id === props.selected?.id)
    if (index === -1 && props.notifications[0]) {
      emit('select', props.notifications[0])
    } else if (index < props.notifications.length - 1) {
      emit('select', props.notifications[index + 1]!)
    }
  },
  arrowup: () => {
    const index = props.notifications.findIndex(n => n.id === props.selected?.id)
    if (index === -1 && props.notifications.length) {
      emit('select', props.notifications[props.notifications.length - 1]!)
    } else if (index > 0) {
      emit('select', props.notifications[index - 1]!)
    }
  }
})

function badgeFor(n: NotificationDoc): string {
  return props.botLabels.get(n.config_id)?.serviceLabel ?? 'unknown'
}

function botNameFor(n: NotificationDoc): string {
  return props.botLabels.get(n.config_id)?.name ?? ''
}
</script>

<template>
  <div v-if="notifications.length" class="overflow-y-auto divide-y divide-default">
    <div
      v-for="notification in notifications"
      :key="notification.id"
      :ref="(el) => { refs[notification.id] = el as Element | null }"
    >
      <div
        class="p-4 sm:px-6 text-sm cursor-pointer border-l-2 transition-colors"
        :class="[
          notification.unread ? 'text-highlighted' : 'text-toned',
          selected && selected.id === notification.id
            ? 'border-primary bg-primary/10'
            : 'border-bg hover:border-primary hover:bg-primary/5'
        ]"
        @click="$emit('select', notification)"
      >
        <div
          class="flex items-center justify-between"
          :class="[notification.unread && 'font-semibold']"
        >
          <div class="flex items-center gap-3 min-w-0">
            <UBadge
              :label="badgeFor(notification)"
              variant="subtle"
              color="neutral"
              size="sm"
            />

            <UChip v-if="notification.unread" />
          </div>

          <time
            :datetime="notification.created_at"
            class="shrink-0 text-xs text-muted"
          >
            {{
              isToday(new Date(notification.created_at))
                ? format(new Date(notification.created_at), 'HH:mm')
                : format(new Date(notification.created_at), 'dd MMM')
            }}
          </time>
        </div>
        <p class="truncate mt-1" :class="[notification.unread && 'font-semibold']">
          {{ notification.title }}
        </p>
        <p v-if="botNameFor(notification)" class="text-dimmed line-clamp-1">
          {{ botNameFor(notification) }}
        </p>
      </div>
    </div>
  </div>

  <div
    v-else
    class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center"
  >
    <UIcon name="i-lucide-inbox" class="size-12 text-dimmed" />
    <p class="text-sm text-muted">
      No matches yet. Create a bot and we will notify you when new listings match your filters.
    </p>
  </div>
</template>
