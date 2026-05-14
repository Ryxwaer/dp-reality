<script setup lang="ts">
import type { BotMeta, ModuleRegistryEntry } from '~~/shared/types'

// Two-step bot wizard:
//
//   Step 1 (BFF metadata): user types a name and toggles email digests.
//          Held in component state until Next; nothing is persisted yet.
//   Step 2 (full-bleed iframe): the bot service's own configure page,
//          loaded via the BFF reverse proxy at module_registry.configure_url.
//          The iframe alone owns the bot-specific filters and the save.
//
// Wizard transitions:
//
//   Next on Step 1 -> POST /api/bots {bot_id, name, email_notifications}.
//                     The BFF mints config_id and inserts a `pending`
//                     row in users.bots[]. The dialog now has a real
//                     BotMeta and advances to Step 2.
//   module:saved   -> PATCH /api/bots/:config_id {status: 'active'}.
//                     The BFF flips the row from `pending` to `active`.
//                     Then close + emit `saved` so the parent refreshes.
//   module:cancel  -> DELETE /api/bots/:config_id (drops both the
//                     pending users.bots[] row and any <bot>_config row
//                     the bot might have already written). Same on the
//                     modal's top-right X.
//
// Edit-mode (props.isNew=false) reuses Step 2 only: no Step 1 form,
// no mint, and module:saved is a plain refresh (the row is already
// active, no status flip needed).
const props = defineProps<{
  open: boolean
  // `null` only on the create flow: parent passes the registry entry,
  // dialog mints the BotMeta on Next. `BotMeta` for edit-mode.
  bot: BotMeta | null
  registry: ModuleRegistryEntry
  isNew: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  saved: []
  cancelled: []
}>()

const colorMode = useColorMode()
const toast = useToast()

const step = ref<1 | 2>(props.isNew ? 1 : 2)
const formName = ref(props.bot?.name ?? '')
const formEmail = ref(props.bot?.email_notifications ?? true)
const minting = ref(false)
const closing = ref(false)
const minted = ref<BotMeta | null>(props.isNew ? null : props.bot)

const iframeHeight = ref(360)
const frameRef = ref<HTMLIFrameElement | null>(null)

const iframeSrc = computed(() => {
  if (!minted.value) return ''
  // No name/email/mode/theme params — the iframe derives create vs.
  // edit by attempting GET /configs/<id>, and theme is propagated via
  // the module:set-theme postMessage on color-mode change.
  const sp = new URLSearchParams({ config_id: minted.value.config_id })
  const path = (props.registry.configure_url || '/configure').replace(/^\/+/, '')
  return `/modules/${minted.value.bot_id}/${path}?${sp.toString()}`
})

watch(() => colorMode.value, (next) => {
  const win = frameRef.value?.contentWindow
  if (!win || !minted.value) return
  // Same origin (BFF) so a precise targetOrigin is safe.
  win.postMessage(
    { type: 'module:set-theme', theme: next === 'dark' ? 'dark' : 'light' },
    window.location.origin
  )
})

interface ChildMessage {
  type?: string
  height?: number
}

async function handleMessage(event: MessageEvent) {
  // The iframe is loaded through the BFF reverse proxy and therefore
  // shares our origin. Reject everything else.
  if (event.origin !== window.location.origin) return
  const win = frameRef.value?.contentWindow
  if (!win || event.source !== win) return
  const data = event.data as ChildMessage | null
  if (!data || typeof data !== 'object') return

  switch (data.type) {
    case 'module:resize':
      if (typeof data.height === 'number' && data.height > 0) {
        iframeHeight.value = Math.min(Math.max(Math.ceil(data.height), 240), 1400)
      }
      break
    case 'module:saved':
      await onSaved()
      break
    case 'module:cancelled':
      void cancel()
      break
  }
}

async function next() {
  if (minting.value) return
  const name = formName.value.trim()
  if (!name) {
    toast.add({ title: 'Please enter a name for this bot', color: 'error' })
    return
  }
  minting.value = true
  try {
    const bot = await $fetch<BotMeta>('/api/bots', {
      method: 'POST',
      body: {
        bot_id: props.registry.bot_id,
        name,
        email_notifications: formEmail.value
      }
    })
    minted.value = bot
    step.value = 2
  } catch {
    toast.add({ title: 'Could not create bot', color: 'error' })
  } finally {
    minting.value = false
  }
}

async function onSaved() {
  if (!minted.value) return
  // For brand-new bots, flip pending -> active. For edits the row is
  // already active so the PATCH would be a no-op; skip it.
  if (props.isNew) {
    try {
      await $fetch(`/api/bots/${minted.value.config_id}`, {
        method: 'PATCH',
        body: { status: 'active' }
      })
    } catch {
      toast.add({ title: 'Bot saved but could not activate', color: 'error' })
      return
    }
  }
  emit('saved')
  emit('update:open', false)
}

async function cancel() {
  if (closing.value) return
  closing.value = true
  try {
    // Step 1 cancel = nothing has been minted yet, just close.
    // Step 2 cancel on a brand-new bot = delete the pending row (and
    // any <bot>_config the bot may have already written).
    if (props.isNew && minted.value) {
      try {
        await $fetch(`/api/bots/${minted.value.config_id}`, { method: 'DELETE' })
      } catch (err) {
        // Best-effort: the janitor reaps any orphan within minutes.
        console.error('[bot-config] cancel cleanup failed:', err)
      }
    }
    emit('cancelled')
    emit('update:open', false)
  } finally {
    closing.value = false
  }
}

onMounted(() => window.addEventListener('message', handleMessage))
onUnmounted(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <UModal
    :open="open"
    :title="isNew && step === 1 ? 'New bot' : (minted?.name || 'Configure bot')"
    :description="`Service: ${registry.display_name}`"
    :ui="{
      content: 'sm:max-w-3xl',
      body: 'p-4 sm:p-5'
    }"
    :close="{ disabled: closing || minting }"
    @update:open="(v: boolean) => v ? emit('update:open', true) : cancel()"
  >
    <template #body>
      <div v-if="step === 1" class="flex flex-col gap-4">
        <UFormField label="Name" required>
          <UInput
            v-model="formName"
            placeholder="e.g. Brno 2+kk under 5M"
            :maxlength="100"
            autofocus
            @keydown.enter="next"
          />
        </UFormField>
        <UFormField
          label="Email digest"
          help="Send a digest email when this bot finds new matches."
        >
          <USwitch v-model="formEmail" />
        </UFormField>
        <div class="flex justify-end gap-2 pt-2 border-t border-default">
          <UButton
            variant="ghost"
            color="neutral"
            label="Cancel"
            :disabled="minting"
            @click="cancel"
          />
          <UButton
            label="Next"
            :loading="minting"
            @click="next"
          />
        </div>
      </div>

      <iframe
        v-else
        ref="frameRef"
        :src="iframeSrc"
        :style="{ height: iframeHeight + 'px' }"
        class="block w-full border-0 bg-transparent transition-[height] duration-150"
        title="Bot configuration"
      />
    </template>
  </UModal>
</template>
