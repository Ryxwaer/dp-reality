<script setup lang="ts">
import type { UnsubscribeSummary, UnsubscribeBot } from '~~/server/api/unsubscribe/[token].get'

definePageMeta({ layout: false })

useHead({ title: 'Unsubscribe' })

const route = useRoute()
const toast = useToast()
const token = route.params.token as string

const { data: summary, error, pending } = await useFetch<UnsubscribeSummary>(
  `/api/unsubscribe/${token}`,
  { lazy: true }
)

interface BotChoice {
  id: string
  name: string
  source_label: string
  module_name: string | null
  disable_email: boolean
  stop_bot: boolean
  initial_email: boolean
  initial_status: 'active' | 'stopped'
}

const sameSourceChoices = ref<BotChoice[]>([])
const otherSourceGroups = ref<Array<{
  source_key: string
  source_label: string
  expanded: boolean
  bots: BotChoice[]
}>>([])

function toChoice(b: UnsubscribeBot, preselectEmailOff: boolean): BotChoice {
  return {
    id: b.id,
    name: b.name,
    source_label: b.source_label,
    module_name: b.module_name,
    // Preselect "disable email" only for same-source bots whose emails
    // are currently on. If emails are already off, showing it as
    // unchecked lets the user *re-enable* via the same form.
    disable_email: preselectEmailOff ? b.email_notifications : false,
    stop_bot: false,
    initial_email: b.email_notifications,
    initial_status: b.status
  }
}

watch(summary, (s) => {
  if (!s) return
  sameSourceChoices.value = s.same_source.map(b => toChoice(b, true))
  otherSourceGroups.value = s.other_sources.map(g => ({
    source_key: g.source_key,
    source_label: g.source_label,
    expanded: false,
    bots: g.bots.map(b => toChoice(b, false))
  }))
}, { immediate: true })

const submitting = ref(false)
const done = ref(false)

const totalOtherBots = computed(() =>
  otherSourceGroups.value.reduce((sum, g) => sum + g.bots.length, 0)
)

const nothingSelected = computed(() => {
  const anySame = sameSourceChoices.value.some(c => c.disable_email || c.stop_bot)
  const anyOther = otherSourceGroups.value.some(g =>
    g.bots.some(c => c.disable_email || c.stop_bot)
  )
  return !anySame && !anyOther
})

function collectUpdates(): Array<{ id: string, email_notifications?: boolean, status?: 'active' | 'stopped' }> {
  const out: Array<{ id: string, email_notifications?: boolean, status?: 'active' | 'stopped' }> = []
  const visit = (c: BotChoice) => {
    const patch: { id: string, email_notifications?: boolean, status?: 'active' | 'stopped' } = { id: c.id }
    let dirty = false
    // `disable_email` true means user wants emails off; unchecked
    // means user wants them on. Only emit a write when this actually
    // flips the current state.
    const wantEmail = !c.disable_email
    if (wantEmail !== c.initial_email) {
      patch.email_notifications = wantEmail
      dirty = true
    }
    if (c.stop_bot && c.initial_status !== 'stopped') {
      patch.status = 'stopped'
      dirty = true
    }
    if (dirty) out.push(patch)
  }
  sameSourceChoices.value.forEach(visit)
  otherSourceGroups.value.forEach(g => g.bots.forEach(visit))
  return out
}

async function submit() {
  const updates = collectUpdates()
  if (updates.length === 0) {
    toast.add({
      title: 'Nothing to apply',
      description: 'No changes selected.',
      color: 'info'
    })
    return
  }
  submitting.value = true
  try {
    await $fetch(`/api/unsubscribe/${token}`, {
      method: 'POST',
      body: { updates }
    })
    done.value = true
    toast.add({
      title: 'Preferences saved',
      description: `Applied ${updates.length} change${updates.length === 1 ? '' : 's'}.`,
      color: 'success'
    })
  } catch {
    toast.add({
      title: 'Could not apply changes',
      description: 'Please try the link again or contact support.',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-default flex items-start justify-center py-10 px-4">
    <UCard class="w-full max-w-2xl">
      <template #header>
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-bell-off" class="size-6 text-primary" />
          <div>
            <h1 class="text-lg font-semibold">
              Email preferences
            </h1>
            <p v-if="summary" class="text-sm text-muted">
              Signed in as {{ summary.email }} — managing <strong>{{ summary.source_label }}</strong> emails.
            </p>
          </div>
        </div>
      </template>

      <div v-if="pending" class="text-sm text-muted">
        Loading…
      </div>

      <div v-else-if="error" class="rounded-md border border-error bg-error/5 p-4 text-sm text-error">
        This unsubscribe link is invalid or has expired. Please sign in to manage
        your bots from the <NuxtLink to="/bots" class="underline">
          Bots page
        </NuxtLink>.
      </div>

      <div v-else-if="done" class="rounded-md border border-success bg-success/5 p-4 text-sm">
        Your preferences have been saved. You can close this tab.
      </div>

      <div v-else-if="summary" class="flex flex-col gap-6">
        <section>
          <h2 class="text-sm font-semibold mb-2">
            Bots for {{ summary.source_label }}
          </h2>
          <div v-if="sameSourceChoices.length === 0" class="text-sm text-muted">
            You have no active bots for this source.
          </div>
          <ul v-else class="flex flex-col gap-2">
            <li
              v-for="bot in sameSourceChoices"
              :key="bot.id"
              class="rounded-md border border-default p-3"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">
                    {{ bot.name }}
                  </p>
                  <p class="text-xs text-muted truncate">
                    {{ bot.module_name ?? bot.source_label }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm shrink-0">
                  <UCheckbox v-model="bot.disable_email" label="Disable emails" />
                  <UCheckbox v-model="bot.stop_bot" label="Stop bot" />
                </div>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="totalOtherBots > 0">
          <h2 class="text-sm font-semibold mb-2">
            Other bots <span class="text-muted font-normal">({{ totalOtherBots }})</span>
          </h2>
          <div class="flex flex-col gap-2">
            <div
              v-for="group in otherSourceGroups"
              :key="group.source_key"
              class="rounded-md border border-default"
            >
              <button
                type="button"
                class="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-elevated/40"
                @click="group.expanded = !group.expanded"
              >
                <span>{{ group.source_label }} ({{ group.bots.length }})</span>
                <UIcon
                  :name="group.expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                  class="size-4"
                />
              </button>
              <ul v-if="group.expanded" class="flex flex-col gap-2 p-3 border-t border-default">
                <li
                  v-for="bot in group.bots"
                  :key="bot.id"
                  class="rounded-md border border-default p-3"
                >
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div class="min-w-0">
                      <p class="text-sm font-medium truncate">
                        {{ bot.name }}
                      </p>
                      <p class="text-xs text-muted truncate">
                        {{ bot.module_name ?? bot.source_label }}
                      </p>
                    </div>
                    <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm shrink-0">
                      <UCheckbox v-model="bot.disable_email" label="Disable emails" />
                      <UCheckbox v-model="bot.stop_bot" label="Stop bot" />
                    </div>
                  </div>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <div class="flex items-center justify-end gap-2 pt-2 border-t border-default">
          <UButton
            label="Apply changes"
            :loading="submitting"
            :disabled="nothingSelected"
            @click="submit"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>
