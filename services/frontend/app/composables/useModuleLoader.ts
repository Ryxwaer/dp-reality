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

/**
 * Payload the module bundle hands back to the host when the user
 * saves. The bundle is the sole producer of `matcher`: it compiles
 * the user's `config` into a concrete {@link ModuleMatcher} (values
 * inlined, no `config.*` indirection) which the server validates
 * against MATCHER_SCHEMA and snapshots onto the bot.
 */
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

/**
 * Downloads a module's compiled JS bundle from the BFF, turns it into a Blob
 * URL, dynamic-imports it and calls its default-exported factory with the
 * provided host. Vue primitives are handed to the module through the host so
 * the module bundle itself does not need to (and MUST NOT) import Vue — this
 * keeps a single Vue instance in the page.
 */
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

/**
 * Thin Vue-style wrapper around [[loadModuleComponent]] that exposes the
 * loaded component plus loading/error state.
 */
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
