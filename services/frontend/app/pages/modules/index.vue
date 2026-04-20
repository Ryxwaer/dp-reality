<script setup lang="ts">
import { formatDistanceToNow } from 'date-fns'

useHead({ title: 'Modules' })

interface ModuleListItem {
  id: string
  name: string
  description: string
  uploaded_by: string
  uploaded_by_name: string
  created_at: string
  updated_at: string
  is_own: boolean
  system: boolean
  editable: boolean
}

const toast = useToast()
const router = useRouter()

const { data: modules, status, refresh } = await useFetch<ModuleListItem[]>('/api/modules', {
  default: () => [],
  lazy: true
})

async function deleteModule(id: string) {
  if (!confirm('Delete this module? Existing bots tied to it will still appear but cannot be edited.')) {
    return
  }
  try {
    await $fetch(`/api/modules/${id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Module deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Could not delete module', color: 'error' })
  }
}

function useModule(id: string) {
  router.push(`/modules/${id}/new`)
}

function editModule(id: string) {
  router.push(`/modules/${id}/edit`)
}

function dropdownItemsFor(m: ModuleListItem) {
  const items: Array<{ label: string, icon: string, color?: 'error', onSelect: () => void }> = []
  if (m.editable) {
    items.push({ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => editModule(m.id) })
  }
  if (m.is_own) {
    items.push({ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => deleteModule(m.id) })
  }
  return items
}

function previewOf(markdown: string, max = 220): string {
  if (!markdown) return ''
  const withoutFences = markdown.replace(/```[\s\S]*?```/g, ' ')
  const firstPara = withoutFences.split(/\n\s*\n/).find(p => p.trim().length && !p.trim().startsWith('#')) ?? ''
  const plain = firstPara
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~>]/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}
</script>

<template>
  <UDashboardPanel id="modules">
    <template #header>
      <UDashboardNavbar title="Modules">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Upload module"
            icon="i-lucide-upload"
            to="/modules/upload"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="status === 'pending'" class="text-sm text-muted">
        Loading modules…
      </div>

      <div v-else-if="!modules.length" class="flex flex-col items-center justify-center py-16 text-center">
        <UIcon name="i-lucide-puzzle" class="size-10 text-muted" />
        <p class="mt-3 text-base font-medium">
          No modules yet
        </p>
        <p class="mt-1 text-sm text-muted max-w-md">
          Modules provide the configuration UI for bots. Upload one to start creating bots.
        </p>
        <UButton
          class="mt-4"
          label="Upload module"
          icon="i-lucide-upload"
          to="/modules/upload"
        />
      </div>

      <div
        v-else
        class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <UCard
          v-for="m in modules"
          :key="m.id"
          :ui="{ body: 'flex flex-col gap-3' }"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="font-semibold truncate">
                {{ m.name }}
              </p>
              <p class="text-xs text-muted">
                by {{ m.uploaded_by_name }} · {{ formatDistanceToNow(new Date(m.created_at), { addSuffix: true }) }}
              </p>
            </div>
            <UDropdownMenu
              v-if="dropdownItemsFor(m).length > 0"
              :items="dropdownItemsFor(m)"
            >
              <UButton
                icon="i-lucide-ellipsis-vertical"
                color="neutral"
                variant="ghost"
                size="xs"
              />
            </UDropdownMenu>
          </div>

          <p v-if="previewOf(m.description)" class="text-sm text-muted line-clamp-3">
            {{ previewOf(m.description) }}
          </p>

          <div class="mt-auto flex">
            <UButton
              label="Use module"
              icon="i-lucide-plus"
              color="primary"
              variant="soft"
              class="w-full justify-center"
              @click="useModule(m.id)"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
