<script setup lang="ts">
import { format } from 'date-fns'
import type { NotificationDoc } from '~~/shared/types'

const props = defineProps<{
  notification: NotificationDoc
}>()

defineEmits<{
  close: []
}>()

// The module's notification spec decided which fields to surface — we
// just show them back in the same order. Source is always shown first
// as a stable pivot so users can tell where a row came from even on
// generic modules with no explicit "source" row.
const infoRows = computed(() => [
  { label: 'Source', value: props.notification.source },
  ...(props.notification.fields ?? [])
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
            {{ notification.source }} · #{{ notification.source_id }}
          </p>
        </div>
      </div>

      <p class="max-sm:pl-16 text-muted text-sm sm:mt-2">
        Matched {{ format(new Date(notification.matched_at), 'dd MMM HH:mm') }}
      </p>
    </div>

    <div class="flex-1 p-4 sm:p-6 overflow-y-auto flex flex-col gap-6">
      <UCard variant="subtle">
        <dl class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div
            v-for="row in infoRows"
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

      <UButton
        :to="notification.url"
        target="_blank"
        icon="i-lucide-external-link"
        trailing
        label="Open listing on source"
        color="neutral"
        variant="subtle"
        class="w-fit"
      />
    </div>
  </UDashboardPanel>
</template>
