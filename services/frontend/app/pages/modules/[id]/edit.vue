<script setup lang="ts">
import type { ModuleDoc } from '~~/shared/types'

const route = useRoute()
const toast = useToast()
const sdkDocs = useSdkDocs()

const moduleId = computed(() => String(route.params.id ?? ''))

const {
  data: existing,
  status,
  error
} = await useFetch<ModuleDoc>(() => `/api/modules/${moduleId.value}`, {
  // Intentionally NOT `lazy` — we need the data before the form
  // mounts so it can hydrate its `initial` prop correctly. Revalidate
  // on mount in case the user edits from another tab.
  default: () => null as unknown as ModuleDoc
})

useHead({ title: () => existing.value ? `Edit ${existing.value.name}` : 'Edit module' })

const saving = ref(false)

async function onSubmit(payload: {
  name: string
  collection: string
  source: string
  description: string
  configSchema: Record<string, unknown>
  notification: { subject: string, title: string, url: string, fields: { label: string, value: string }[] }
  code: string | null
}) {
  if (!existing.value) return

  // Build a PATCH body that only includes fields the user actually
  // changed. Keeps the request small, avoids bouncing the same
  // values through server-side validation, and makes the audit trail
  // obvious ("user only touched the notification").
  const body: Record<string, unknown> = {}
  if (payload.name !== existing.value.name) body.name = payload.name
  if (payload.description !== existing.value.description) body.description = payload.description
  if (JSON.stringify(payload.configSchema) !== JSON.stringify(existing.value.configSchema)) {
    body.configSchema = payload.configSchema
  }
  if (JSON.stringify(payload.notification) !== JSON.stringify(existing.value.notification)) {
    body.notification = payload.notification
  }
  // `code: null` from the form means "keep the existing bundle"; only
  // send `code` when the user explicitly picked a new file.
  if (payload.code) body.code = payload.code

  if (Object.keys(body).length === 0) {
    toast.add({ title: 'Nothing to save', color: 'info' })
    return
  }

  saving.value = true
  try {
    await $fetch(`/api/modules/${moduleId.value}`, {
      method: 'PATCH',
      body
    })
    toast.add({ title: 'Module updated', color: 'success' })
    await navigateTo('/modules')
  } catch (err) {
    const message = (err as { data?: { message?: string }, message?: string }).data?.message
      ?? (err as Error).message
      ?? 'Save failed'
    toast.add({ title: 'Save failed', description: message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function onCancel() {
  await navigateTo('/modules')
}
</script>

<template>
  <UDashboardPanel id="modules-edit">
    <template #header>
      <UDashboardNavbar :title="existing ? `Edit: ${existing.name}` : 'Edit module'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <MarkdownPanel
            variant="trigger"
            title="SDK reference"
            :source="sdkDocs"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="status === 'pending'" class="text-sm text-muted">
        Loading module…
      </div>
      <div v-else-if="error || !existing" class="text-sm text-error">
        Failed to load module: {{ error?.statusMessage ?? 'not found' }}
      </div>
      <ModulesModuleForm
        v-else
        :initial="existing"
        :lock-identity="true"
        :lock-code="existing.system"
        submit-label="Save"
        :busy="saving"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>
  </UDashboardPanel>
</template>
