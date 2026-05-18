<script setup lang="ts">
import type { BotMeta, ModuleRegistryEntry } from '~~/shared/types'

const props = defineProps<{
  open: boolean
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
const { headers: csrfHeaders } = useCsrf()

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
  const sp = new URLSearchParams({ config_id: minted.value.config_id })
  const path = (props.registry.configure_url || '/configure').replace(/^\/+/, '')
  return `/modules/${minted.value.bot_id}/${path}?${sp.toString()}`
})

watch(() => colorMode.value, (next) => {
  const win = frameRef.value?.contentWindow
  if (!win || !minted.value) return
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
      headers: csrfHeaders(),
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
  if (props.isNew) {
    try {
      await $fetch(`/api/bots/${minted.value.config_id}`, {
        method: 'PATCH',
        headers: csrfHeaders(),
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
    if (props.isNew && minted.value) {
      try {
        await $fetch(`/api/bots/${minted.value.config_id}`, {
          method: 'DELETE',
          headers: csrfHeaders()
        })
      } catch (err) {
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
