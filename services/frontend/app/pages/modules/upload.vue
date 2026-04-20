<script setup lang="ts">
useHead({ title: 'Upload module' })

const loading = ref(false)
const toast = useToast()
const sdkDocs = useSdkDocs()

async function onSubmit(payload: {
  name: string
  collection: string
  source: string
  description: string
  configSchema: Record<string, unknown>
  notification: { subject: string, title: string, url: string, fields: { label: string, value: string }[] }
  code: string | null
}) {
  if (!payload.code) {
    toast.add({ title: 'Bundle file is required', color: 'error' })
    return
  }
  loading.value = true
  try {
    await $fetch('/api/modules', {
      method: 'POST',
      body: {
        name: payload.name,
        collection: payload.collection,
        source: payload.source,
        description: payload.description,
        configSchema: payload.configSchema,
        notification: payload.notification,
        code: payload.code
      }
    })
    toast.add({ title: 'Module uploaded', color: 'success' })
    await navigateTo('/modules')
  } catch (err) {
    const message = (err as { data?: { message?: string }, message?: string }).data?.message
      ?? (err as Error).message
      ?? 'Upload failed'
    toast.add({ title: 'Upload failed', description: message, color: 'error' })
  } finally {
    loading.value = false
  }
}

async function onCancel() {
  await navigateTo('/modules')
}
</script>

<template>
  <UDashboardPanel id="modules-upload">
    <template #header>
      <UDashboardNavbar title="Upload module">
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
      <ModulesModuleForm
        submit-label="Upload"
        :busy="loading"
        @submit="onSubmit"
        @cancel="onCancel"
      />
    </template>
  </UDashboardPanel>
</template>
