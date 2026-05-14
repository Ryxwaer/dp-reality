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
  config_id: string
  name: string
  bot_id: string
  disable_email: boolean
  stop_bot: boolean
  initial_email: boolean
  initial_status: 'active' | 'stopped'
}

interface ServiceGroupView {
  bot_id: string
  display_name: string
  expanded: boolean
  bots: BotChoice[]
}

const groups = ref<ServiceGroupView[]>([])

function toChoice(b: UnsubscribeBot, preselectDisable: boolean): BotChoice {
  return {
    config_id: b.config_id,
    name: b.name,
    bot_id: b.bot_id,
    // Pre-checking "Disable emails" only makes sense for configs that
    // are currently sending — otherwise the box would be ticked next
    // to a "emails off" subtitle, suggesting a change that the submit
    // logic would silently skip.
    disable_email: preselectDisable && b.email_notifications,
    stop_bot: false,
    initial_email: b.email_notifications,
    initial_status: b.status
  }
}

const triggeredBotId = computed(() => summary.value?.triggered_by_bot_id ?? null)
const triggeredGroupName = computed(() =>
  triggeredBotId.value
    ? summary.value?.groups.find(g => g.bot_id === triggeredBotId.value)?.display_name ?? null
    : null
)

watch(summary, (s) => {
  if (!s) return
  const triggered = s.triggered_by_bot_id
  groups.value = s.groups.map(g => ({
    bot_id: g.bot_id,
    display_name: g.display_name,
    // Only the originating group is expanded by default; the others
    // collapse so the page's focus matches the user's intent ("turn off
    // *this* bot's emails") without forcing them to scan unrelated
    // sections. Falls back to the previous "all expanded" behaviour
    // when the token has no bid (older email-notifier build).
    expanded: triggered ? g.bot_id === triggered : true,
    bots: g.bots.map(b => toChoice(b, triggered === g.bot_id))
  }))
}, { immediate: true })

const submitting = ref(false)
const done = ref(false)

const totalBots = computed(() => groups.value.reduce((sum, g) => sum + g.bots.length, 0))

const nothingSelected = computed(() =>
  !groups.value.some(g => g.bots.some(b => b.disable_email || b.stop_bot))
)

function collectUpdates(): Array<{ config_id: string, email_notifications?: boolean, status?: 'active' | 'stopped' }> {
  const out: Array<{ config_id: string, email_notifications?: boolean, status?: 'active' | 'stopped' }> = []
  for (const g of groups.value) {
    for (const c of g.bots) {
      const patch: { config_id: string, email_notifications?: boolean, status?: 'active' | 'stopped' } = { config_id: c.config_id }
      let dirty = false
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
  }
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
              Signed in as {{ summary.email }} — {{ totalBots }} bot{{ totalBots === 1 ? '' : 's' }}.
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
        <div v-if="totalBots === 0" class="text-sm text-muted">
          You have no active bots.
        </div>

        <div
          v-if="triggeredGroupName"
          class="rounded-md border border-default bg-elevated/40 p-3 text-sm text-muted flex items-start gap-2"
        >
          <UIcon name="i-lucide-info" class="size-4 mt-0.5 shrink-0" />
          <span>
            You clicked unsubscribe from a <strong class="text-default">{{ triggeredGroupName }}</strong> digest.
            All currently-emailing {{ triggeredGroupName }} configs are pre-selected to be silenced.
            Adjust any of the boxes below — nothing is applied until you click <strong class="text-default">Apply changes</strong>.
          </span>
        </div>

        <section
          v-for="group in groups"
          :key="group.bot_id"
          class="rounded-md border border-default"
        >
          <button
            type="button"
            class="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-elevated/40"
            @click="group.expanded = !group.expanded"
          >
            <span>{{ group.display_name }} ({{ group.bots.length }})</span>
            <UIcon
              :name="group.expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              class="size-4"
            />
          </button>
          <ul v-if="group.expanded" class="flex flex-col gap-2 p-3 border-t border-default">
            <li
              v-for="bot in group.bots"
              :key="bot.config_id"
              class="rounded-md border border-default p-3"
            >
              <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate">
                    {{ bot.name }}
                  </p>
                  <p class="text-xs text-muted">
                    {{ bot.initial_status === 'stopped' ? 'Currently paused' : 'Currently running' }}
                    · emails {{ bot.initial_email ? 'on' : 'off' }}
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
