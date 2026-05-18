<script setup lang="ts">
import { format } from 'date-fns'
import type { NotificationDoc } from '~~/shared/types'

const props = defineProps<{
  notification: NotificationDoc
  serviceLabel: string
  botName: string
}>()

defineEmits<{
  close: []
}>()

const meta = computed(() => [
  { label: 'Bot', value: props.botName || '—' },
  { label: 'Source', value: props.serviceLabel || '—' },
  { label: 'Source ref', value: props.notification.source_ref || '—' }
])
</script>

<template>
  <UDashboardPanel id="inbox-2">
    <UDashboardNavbar :title="notification.title" :toggle="false">
      <template #leading>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          class="-ms-1.5"
          @click="$emit('close')"
        />
      </template>

      <template #right>
        <UTooltip text="Open on source">
          <UButton
            :to="notification.url"
            target="_blank"
            icon="i-lucide-external-link"
            color="neutral"
            variant="ghost"
          />
        </UTooltip>
      </template>
    </UDashboardNavbar>

    <div class="flex flex-col sm:flex-row justify-between gap-1 p-4 sm:px-6 border-b border-default">
      <div class="flex items-start gap-4 sm:my-1.5">
        <UAvatar
          size="3xl"
          icon="i-lucide-house"
          :ui="{ root: 'bg-primary/10 text-primary' }"
        />

        <div class="min-w-0">
          <p class="font-semibold text-highlighted break-words">
            {{ notification.title }}
          </p>
          <p class="text-muted">
            {{ serviceLabel }}<span v-if="botName"> · {{ botName }}</span>
          </p>
        </div>
      </div>

      <p class="max-sm:pl-16 text-muted text-sm sm:mt-2">
        Matched {{ format(new Date(notification.created_at), 'dd MMM HH:mm') }}
      </p>
    </div>

    <div class="flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col gap-6">
      <UCard variant="subtle">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div
            v-for="row in meta"
            :key="row.label"
            class="flex justify-between gap-4 border-b border-default last:border-b-0 pb-2 sm:border-b-0 sm:pb-0"
          >
            <dt class="text-muted">
              {{ row.label }}
            </dt>
            <dd class="text-highlighted text-right">
              {{ row.value }}
            </dd>
          </div>
        </dl>
      </UCard>

      <a
        :href="notification.url"
        target="_blank"
        rel="noopener noreferrer"
        class="block rounded-md border border-default p-4 bg-default text-current no-underline hover:bg-elevated transition-colors"
        :aria-label="`Open ${notification.title} on source`"
        v-html="notification.html"
      />
    </div>
  </UDashboardPanel>
</template>
