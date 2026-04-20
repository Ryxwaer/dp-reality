import type { ModuleFactory, ModuleMatcher } from '../host-types'

// Starter template: single-input bot storing a comma-separated list of
// cities. `compileMatcher` inlines the user's validated config into a
// matcher; drop `in`/`nin` filters whose value array is empty. Never
// import Vue — use primitives from the `host` argument.
const factory: ModuleFactory = ({ h, ref, saveBot, existingBot }) => ({
  setup() {
    const existingCities = Array.isArray(existingBot?.config?.cities)
      ? existingBot.config.cities as string[]
      : []

    const name = ref(existingBot?.name ?? 'My bot')
    const citiesText = ref(existingCities.join(', '))
    const submitting = ref(false)
    const errorMessage = ref<string | null>(null)

    function compileMatcher(config: { cities: string[] }): ModuleMatcher {
      const filters: ModuleMatcher['filters'] = []
      if (config.cities.length > 0) {
        filters.push({ field: 'city', op: 'in', value: config.cities, ci: true })
      }
      return { filters }
    }

    async function onSubmit(e: Event) {
      e.preventDefault()
      errorMessage.value = null
      submitting.value = true
      try {
        const cities = citiesText.value
          .split(',')
          .map(c => c.trim())
          .filter(Boolean)
        const config = { cities }

        await saveBot({
          name: name.value.trim() || 'Untitled bot',
          config,
          matcher: compileMatcher(config)
        })
      } catch (err) {
        errorMessage.value = (err as Error).message ?? 'Failed to save bot'
      } finally {
        submitting.value = false
      }
    }

    const labelCls = 'block text-sm font-medium mb-1'
    const inputCls = 'w-full rounded-md border border-default bg-default px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary'

    return () => h('form', {
      class: 'flex flex-col gap-4 max-w-xl',
      onSubmit
    }, [
      h('div', {}, [
        h('label', { class: labelCls, for: 'bot-name' }, 'Bot name'),
        h('input', {
          id: 'bot-name',
          class: inputCls,
          value: name.value,
          onInput: (e: Event) => { name.value = (e.target as HTMLInputElement).value }
        })
      ]),

      h('div', {}, [
        h('label', { class: labelCls, for: 'bot-cities' }, 'Cities (comma separated)'),
        h('input', {
          id: 'bot-cities',
          class: inputCls,
          placeholder: 'Praha, Brno, Ostrava',
          value: citiesText.value,
          onInput: (e: Event) => { citiesText.value = (e.target as HTMLInputElement).value }
        })
      ]),

      errorMessage.value
        ? h('p', { class: 'text-sm text-error' }, errorMessage.value)
        : null,

      h('div', { class: 'flex items-center gap-2' }, [
        h('button', {
          type: 'submit',
          class: 'rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
          disabled: submitting.value
        }, submitting.value ? 'Saving…' : (existingBot ? 'Save changes' : 'Create bot'))
      ])
    ])
  }
})

export default factory
