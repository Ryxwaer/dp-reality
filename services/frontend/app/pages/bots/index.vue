<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { Row } from '@tanstack/table-core'
import { getPaginationRowModel } from '@tanstack/table-core'
import { format } from 'date-fns'
import type { BotMeta, ModuleRegistryEntry } from '~~/shared/types'

useHead({ title: 'Bots' })

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UDropdownMenu = resolveComponent('UDropdownMenu')
const UIcon = resolveComponent('UIcon')

const toast = useToast()
const table = useTemplateRef('table')

const columnFilters = ref([{ id: 'name', value: '' }])
const columnVisibility = ref()
const rowSelection = ref({})

const { data: bots, status, refresh } = await useFetch<BotMeta[]>('/api/bots', {
  default: () => [],
  lazy: true
})

const { data: registry } = await useFetch<{ items: ModuleRegistryEntry[] }>(
  '/api/modules/registry',
  { default: () => ({ items: [] }), lazy: true }
)

const serviceLabel = computed(() => {
  const m = new Map<string, string>()
  for (const r of registry.value?.items ?? []) m.set(r.bot_id, r.display_name)
  return m
})

// The picker now lives on /store (a full marketplace page) so this
// dashboard only manages already-minted bots. configBot holds the bot
// whose iframe-hosted configurator is currently mounted, alongside the
// matching registry entry the dialog needs for the iframe src.
const configBot = ref<BotMeta | null>(null)
const configRegistry = ref<ModuleRegistryEntry | null>(null)

function openEdit(bot: BotMeta) {
  const entry = (registry.value?.items ?? []).find(e => e.bot_id === bot.bot_id)
  if (!entry) {
    toast.add({ title: 'Bot service is offline', color: 'error' })
    return
  }
  configBot.value = bot
  configRegistry.value = entry
}

function closeConfig() {
  configBot.value = null
  configRegistry.value = null
}

async function patchBot(bot: BotMeta, patch: Partial<Pick<BotMeta, 'status' | 'email_notifications'>>) {
  try {
    await $fetch(`/api/bots/${bot.config_id}`, { method: 'PATCH', body: patch })
    await refresh()
  } catch {
    toast.add({ title: 'Could not update bot', color: 'error' })
  }
}

async function toggleStatus(bot: BotMeta) {
  const next = bot.status === 'active' ? 'stopped' : 'active'
  await patchBot(bot, { status: next })
  toast.add({
    title: next === 'active' ? 'Bot resumed' : 'Bot paused',
    color: 'success'
  })
}

async function toggleEmail(bot: BotMeta) {
  const next = !bot.email_notifications
  await patchBot(bot, { email_notifications: next })
  toast.add({
    title: next ? 'Emails enabled' : 'Emails disabled',
    color: 'success'
  })
}

async function deleteBot(bot: BotMeta) {
  try {
    await $fetch(`/api/bots/${bot.config_id}`, { method: 'DELETE' })
    await refresh()
    toast.add({ title: 'Bot deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Could not delete bot', color: 'error' })
  }
}

function getRowItems(row: Row<BotMeta>) {
  const bot = row.original
  return [
    { type: 'label' as const, label: 'Actions' },
    {
      label: 'Edit config',
      icon: 'i-lucide-pencil',
      onSelect() { openEdit(bot) }
    },
    {
      label: bot.status === 'active' ? 'Pause bot' : 'Resume bot',
      icon: bot.status === 'active' ? 'i-lucide-pause' : 'i-lucide-play',
      onSelect() { void toggleStatus(bot) }
    },
    {
      label: bot.email_notifications ? 'Disable emails' : 'Enable emails',
      icon: bot.email_notifications ? 'i-lucide-bell-off' : 'i-lucide-bell',
      onSelect() { void toggleEmail(bot) }
    },
    {
      label: 'Copy config ID',
      icon: 'i-lucide-copy',
      onSelect() {
        navigator.clipboard.writeText(bot.config_id)
        toast.add({ title: 'Copied to clipboard', description: 'Config ID copied.' })
      }
    },
    { type: 'separator' as const },
    {
      label: 'Delete bot',
      icon: 'i-lucide-trash',
      color: 'error' as const,
      onSelect() { void deleteBot(bot) }
    }
  ]
}

const columns: TableColumn<BotMeta>[] = [
  { accessorKey: 'name', header: 'Name' },
  {
    accessorKey: 'bot_id',
    header: 'Service',
    cell: ({ row }) => h(
      UBadge,
      { variant: 'subtle', color: 'neutral' },
      () => serviceLabel.value.get(row.original.bot_id) ?? row.original.bot_id
    )
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

function onConfigSaved() {
  refresh()
  closeConfig()
  toast.add({ title: 'Bot saved', color: 'success' })
}

function onConfigCancelled() {
  // The dialog cleans up provisional bots on cancel; refresh the list
  // so the deleted row disappears from the table immediately.
  refresh()
  closeConfig()
}
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
            to="/store"
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

      <ClientOnly>
        <BotsBotConfigDialog
          v-if="configBot && configRegistry"
          :open="!!configBot"
          :bot="configBot"
          :registry="configRegistry"
          :is-new="false"
          @update:open="(v) => !v && closeConfig()"
          @saved="onConfigSaved"
          @cancelled="onConfigCancelled"
        />
      </ClientOnly>
    </template>
  </UDashboardPanel>
</template>
