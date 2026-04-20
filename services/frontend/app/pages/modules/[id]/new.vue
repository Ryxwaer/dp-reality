<script setup lang="ts">
import type { ModuleDoc } from '~~/shared/types'
import {
  useModuleLoader,
  buildHost,
  type SaveBotPayload
} from '~/composables/useModuleLoader'

useHead({ title: 'New bot' })

const route = useRoute()
const toast = useToast()
const moduleId = route.params.id as string

const { data: moduleDoc, error: moduleError } = await useFetch<ModuleDoc>(
  `/api/modules/${moduleId}`,
  { lazy: true }
)

const { component, loading, error, load } = useModuleLoader()

const emailNotifications = ref(true)

async function saveBot(payload: SaveBotPayload) {
  await $fetch('/api/bots', {
    method: 'POST',
    body: {
      ...payload,
      module_id: moduleId,
      email_notifications: emailNotifications.value
    }
  })
  toast.add({ title: 'Bot created', color: 'success' })
  await navigateTo('/bots')
}

onMounted(() => {
  const host = buildHost(moduleId, null, saveBot)
  load(moduleId, host)
})
</script>

<template>
  <UDashboardPanel id="module-new">
    <template #header>
      <UDashboardNavbar :title="moduleDoc?.name || 'New bot'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <MarkdownPanel
            v-if="moduleDoc?.description"
            variant="trigger"
            title="Module docs"
            :source="moduleDoc.description"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="moduleError" class="text-sm text-error">
        Module not found.
      </div>

      <div v-else class="flex flex-col lg:flex-row gap-6">
        <div class="w-full lg:w-auto lg:max-w-2xl lg:shrink-0 min-w-0">
          <div v-if="loading" class="text-sm text-muted">
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
            description="Send an email digest when this bot finds new matches. You can change this later from the bots list."
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
