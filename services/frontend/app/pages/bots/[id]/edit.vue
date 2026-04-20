<script setup lang="ts">
import type { BotConfig, ModuleDoc } from '~~/shared/types'
import {
  useModuleLoader,
  buildHost,
  type SaveBotPayload
} from '~/composables/useModuleLoader'

useHead({ title: 'Edit bot' })

// Module bundles load via URL.createObjectURL + import(), which requires the client.
definePageMeta({ ssr: false })

const route = useRoute()
const toast = useToast()
const botId = route.params.id as string

const { data: bot, error: botError } = await useFetch<BotConfig>(
  `/api/bots/${botId}`,
  { lazy: true, server: false }
)

const moduleDoc = ref<ModuleDoc | null>(null)
const moduleMissing = ref(false)

const { component, loading, error, load } = useModuleLoader()
const bootError = ref<string | null>(null)

const emailNotifications = ref(true)

async function saveBot(payload: SaveBotPayload) {
  await $fetch(`/api/bots/${botId}`, {
    method: 'PATCH',
    body: { ...payload, email_notifications: emailNotifications.value }
  })
  toast.add({ title: 'Bot updated', color: 'success' })
  await navigateTo('/bots')
}

async function boot(b: BotConfig) {
  emailNotifications.value = b.email_notifications
  try {
    moduleDoc.value = await $fetch<ModuleDoc>(`/api/modules/${b.module_id}`)
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 404) {
      moduleMissing.value = true
      return
    }
    throw err
  }

  const host = buildHost(
    b.module_id,
    {
      id: b.id,
      name: b.name,
      config: b.config,
      active: b.status === 'active'
    },
    saveBot
  )
  await load(b.module_id, host)
}

// Lazy useFetch resolves after mount; this watcher kicks boot once.
const booted = ref(false)
watch(bot, (b) => {
  if (!b || booted.value) return
  booted.value = true
  boot(b).catch((err) => {
    const msg = err instanceof Error
      ? err.message
      : typeof err === 'object' && err && 'statusMessage' in err
        ? String((err as { statusMessage?: string }).statusMessage)
        : 'Failed to load module'
    bootError.value = msg
  })
}, { immediate: true })
</script>

<template>
  <UDashboardPanel id="bot-edit">
    <template #header>
      <UDashboardNavbar :title="bot?.name || 'Edit bot'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <MarkdownPanel
            v-if="moduleDoc?.description && !moduleMissing"
            variant="trigger"
            title="Module docs"
            :source="moduleDoc.description"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="botError" class="text-sm text-error">
        Bot not found.
      </div>

      <div v-else-if="moduleMissing" class="rounded-md border border-warning bg-warning/5 p-3 text-sm">
        The module used by this bot is no longer available. You can delete the bot
        from the bots list, but editing is not possible until the module is restored.
      </div>

      <div v-else class="flex flex-col lg:flex-row gap-6">
        <div class="w-full lg:w-auto lg:max-w-2xl lg:shrink-0 min-w-0">
          <p v-if="moduleDoc?.name" class="text-sm text-muted mb-4">
            Module: {{ moduleDoc.name }}
          </p>

          <div v-if="bootError" class="rounded-md border border-error bg-error/5 p-3 text-sm text-error">
            {{ bootError }}
          </div>
          <div v-else-if="loading" class="text-sm text-muted">
            Loading module…
          </div>
          <div v-else-if="error" class="rounded-md border border-error bg-error/5 p-3 text-sm text-error">
            {{ error }}
          </div>

          <component :is="component" v-if="component" />

          <UFormField
            v-if="component"
            name="email_notifications"
            label="Email notifications"
            description="Send an email digest when this bot finds new matches."
            class="mt-6 flex items-center justify-between gap-2 border-t border-default pt-4"
          >
            <USwitch v-model="emailNotifications" />
          </UFormField>
        </div>

        <MarkdownPanel
          v-if="moduleDoc?.description"
          variant="side"
          title="Module docs"
          :source="moduleDoc.description"
        />
      </div>
    </template>
  </UDashboardPanel>
</template>
