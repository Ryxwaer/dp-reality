<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Row } from '@tanstack/table-core'
import { getPaginationRowModel } from '@tanstack/table-core'
import { format } from 'date-fns'
import type { BotConfig } from '~~/shared/types'

useHead({ title: 'Bots' })

interface ModuleListItem {
  id: string
  name: string
  description: string
  uploaded_by: string
  uploaded_by_name: string
  created_at: string
  updated_at: string
  is_own: boolean
}

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')
const UIcon = resolveComponent('UIcon')

const router = useRouter()
const toast = useToast()
const table = useTemplateRef('table')

const columnFilters = ref([{ id: 'name', value: '' }])
const columnVisibility = ref()
const rowSelection = ref({})

const { data: bots, status, refresh } = await useFetch<BotConfig[]>('/api/bots', {
  default: () => [],
  lazy: true
})

const { data: modules } = await useFetch<ModuleListItem[]>('/api/modules', {
  default: () => [],
  lazy: true
})

const moduleNameById = computed(() => {
  const map = new Map<string, string>()
  for (const m of modules.value) {
    map.set(m.id, m.name)
  }
  return map
})

async function patchBot(bot: BotConfig, patch: Partial<Pick<BotConfig, 'status' | 'email_notifications'>>) {
  try {
    await $fetch(`/api/bots/${bot.id}`, {
      method: 'PATCH',
      body: patch
    })
    await refresh()
  } catch {
    toast.add({ title: 'Could not update bot', color: 'error' })
  }
}

async function toggleStatus(bot: BotConfig) {
  const next = bot.status === 'active' ? 'stopped' : 'active'
  await patchBot(bot, { status: next })
  toast.add({
    title: next === 'active' ? 'Bot resumed' : 'Bot paused',
    color: 'success'
  })
}

async function toggleEmail(bot: BotConfig) {
  const next = !bot.email_notifications
  await patchBot(bot, { email_notifications: next })
  toast.add({
    title: next ? 'Emails enabled' : 'Emails disabled',
    color: 'success'
  })
}

async function deleteBot(bot: BotConfig) {
  try {
    await $fetch(`/api/bots/${bot.id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Bot deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Could not delete bot', color: 'error' })
  }
}

function getRowItems(row: Row<BotConfig>) {
  const bot = row.original
  const moduleKnown = moduleNameById.value.has(bot.module_id)
  return [
    { type: 'label' as const, label: 'Actions' },
    {
      label: 'Edit bot',
      icon: 'i-lucide-pencil',
      disabled: !moduleKnown,
      onSelect() {
        router.push(`/bots/${bot.id}/edit`)
      }
    },
    {
      label: bot.status === 'active' ? 'Pause bot' : 'Resume bot',
      icon: bot.status === 'active' ? 'i-lucide-pause' : 'i-lucide-play',
      onSelect() {
        toggleStatus(bot)
      }
    },
    {
      label: bot.email_notifications ? 'Disable emails' : 'Enable emails',
      icon: bot.email_notifications ? 'i-lucide-bell-off' : 'i-lucide-bell',
      onSelect() {
        toggleEmail(bot)
      }
    },
    {
      label: 'Copy bot ID',
      icon: 'i-lucide-copy',
      onSelect() {
        navigator.clipboard.writeText(bot.id)
        toast.add({ title: 'Copied to clipboard', description: 'Bot ID copied.' })
      }
    },
    { type: 'separator' as const },
    {
      label: 'Delete bot',
      icon: 'i-lucide-trash',
      color: 'error' as const,
      onSelect() {
        deleteBot(bot)
      }
    }
  ]
}

const columns: TableColumn<BotConfig>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    id: 'module',
    header: 'Module',
    cell: ({ row }) => {
      const name = moduleNameById.value.get(row.original.module_id)
      if (name) return name
      return h('span', { class: 'text-xs text-muted italic' }, 'unavailable')
    }
  },
  {
    accessorKey: 'source',
    header: 'Source',
    cell: ({ row }) => row.original.source
      ? h(UBadge, { variant: 'subtle', color: 'neutral' }, () => row.original.source)
      : h('span', { class: 'text-xs text-muted italic' }, '—')
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => h(
      UBadge,
      {
        class: 'capitalize',
        variant: 'subtle',
        color: row.original.status === 'active' ? 'success' : 'neutral'
      },
      () => row.original.status
    )
  },
  {
    accessorKey: 'email_notifications',
    header: 'Email',
    cell: ({ row }) => h(
      'div',
      { class: 'flex items-center gap-1.5 text-xs text-muted' },
      [
        h(UIcon, {
          name: row.original.email_notifications ? 'i-lucide-bell' : 'i-lucide-bell-off',
          class: row.original.email_notifications ? 'text-primary' : 'text-muted'
        }),
        row.original.email_notifications ? 'on' : 'off'
      ]
    )
  },
  {
    accessorKey: 'created_at',
    header: 'Created',
    cell: ({ row }) => row.original.created_at
      ? format(new Date(row.original.created_at), 'dd MMM yyyy')
      : '—'
  },
  {
    accessorKey: 'expires_at',
    header: 'Expires',
    cell: ({ row }) => row.original.expires_at
      ? format(new Date(row.original.expires_at), 'dd MMM yyyy')
      : '—'
  },
  {
    id: 'actions',
    cell: ({ row }) => h(
      'div',
      { class: 'text-right' },
      h(UDropdownMenu, {
        content: { align: 'end' },
        items: getRowItems(row)
      }, () => h(UButton, {
        icon: 'i-lucide-ellipsis-vertical',
        color: 'neutral',
        variant: 'ghost',
        class: 'ml-auto'
      }))
    )
  }
]

const nameFilter = computed({
  get: (): string => {
    return (table.value?.tableApi?.getColumn('name')?.getFilterValue() as string) || ''
  },
  set: (value: string) => {
    table.value?.tableApi?.getColumn('name')?.setFilterValue(value || undefined)
  }
})

const pagination = ref({ pageIndex: 0, pageSize: 10 })
</script>

<template>
  <UDashboardPanel id="bots">
    <template #header>
      <UDashboardNavbar title="Bots">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="New bot"
            icon="i-lucide-plus"
            to="/modules"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-wrap items-center justify-between gap-1.5">
        <UInput
          v-model="nameFilter"
          class="max-w-sm"
          icon="i-lucide-search"
          placeholder="Filter by name..."
        />
      </div>

      <UTable
        ref="table"
        v-model:column-filters="columnFilters"
        v-model:column-visibility="columnVisibility"
        v-model:row-selection="rowSelection"
        v-model:pagination="pagination"
        :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
        class="shrink-0"
        :data="bots"
        :columns="columns"
        :loading="status === 'pending'"
        :empty-state="{
          icon: 'i-lucide-bot',
          label: 'No bots yet'
        }"
        :ui="{
          base: 'table-fixed border-separate border-spacing-0',
          thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
          tbody: '[&>tr]:last:[&>td]:border-b-0',
          th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
          td: 'border-b border-default',
          separator: 'h-0'
        }"
      />

      <div class="flex items-center justify-between gap-3 border-t border-default pt-4 mt-auto">
        <div class="text-sm text-muted">
          {{ bots.length }} bot(s)
        </div>

        <div class="flex items-center gap-1.5">
          <UPagination
            :default-page="(table?.tableApi?.getState().pagination.pageIndex || 0) + 1"
            :items-per-page="table?.tableApi?.getState().pagination.pageSize"
            :total="table?.tableApi?.getFilteredRowModel().rows.length"
            @update:page="(p: number) => table?.tableApi?.setPageIndex(p - 1)"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
