import {
  h,
  ref,
  reactive,
  computed,
  watch,
  onMounted,
  type Component
} from 'vue'
import type { ModuleMatcher } from '~~/shared/types'

export interface ExistingBotInput {
  id: string
  name: string
  config: Record<string, unknown>
  active: boolean
}

export interface SaveBotPayload {
  name: string
  config: Record<string, unknown>
  matcher: ModuleMatcher
  active?: boolean
}

export interface ModuleHost {
  h: typeof h
  ref: typeof ref
  reactive: typeof reactive
  computed: typeof computed
  watch: typeof watch
  onMounted: typeof onMounted
  moduleId: string
  existingBot: ExistingBotInput | null
  saveBot: (payload: SaveBotPayload) => Promise<void>
}

export type ModuleFactory = (host: ModuleHost) => Component

// Fetch the bundle over HTTP, materialize it as a blob URL and
// dynamic-import it. Vue primitives flow through the host so the
// module must not import Vue directly (keeps a single Vue instance).
export async function loadModuleComponent(
  moduleId: string,
  host: ModuleHost
): Promise<Component> {
  const code = await $fetch<string>(`/api/modules/${moduleId}/bundle.mjs`, {
    responseType: 'text'
  })

  const blob = new Blob([code], { type: 'text/javascript' })
  const url = URL.createObjectURL(blob)
  try {
    const mod = await import(/* @vite-ignore */ url) as { default?: ModuleFactory }
    if (typeof mod.default !== 'function') {
      throw new Error('Module does not export a factory as default export')
    }
    return mod.default(host)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function useModuleLoader() {
  const component = shallowRef<Component | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load(moduleId: string, host: ModuleHost) {
    loading.value = true
    error.value = null
    try {
      component.value = await loadModuleComponent(moduleId, host)
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode
      if (status === 404) {
        error.value = 'Module unavailable — it may have been deleted.'
      } else {
        error.value = (err as Error).message ?? 'Failed to load module'
      }
      component.value = null
    } finally {
      loading.value = false
    }
  }

  return { component, loading, error, load }
}

export function buildHost(
  moduleId: string,
  existingBot: ExistingBotInput | null,
  saveBot: (payload: SaveBotPayload) => Promise<void>
): ModuleHost {
  return {
    h,
    ref,
    reactive,
    computed,
    watch,
    onMounted,
    moduleId,
    existingBot,
    saveBot
  }
}
