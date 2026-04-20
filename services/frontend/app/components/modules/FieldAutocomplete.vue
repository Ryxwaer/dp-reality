<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  modelValue: string
  keys: string[]
  placeholder?: string
  extraKeys?: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const inputEl = ref<HTMLInputElement | null>(null)
const overlayEl = ref<HTMLDivElement | null>(null)
const open = ref(false)
const highlight = ref(0)

const MUSTACHE_BADGE = '{{…}}'

const validKeys = computed(() => new Set([...props.keys, ...(props.extraKeys ?? [])]))

const PLACEHOLDER_SOURCE = '\\{\\{\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*\\}\\}'
const BARE_IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/

interface Segment {
  text: string
  kind: 'plain' | 'known' | 'unknown'
}

const segments = computed<Segment[]>(() => {
  const value = props.modelValue ?? ''
  const out: Segment[] = []
  let last = 0
  const re = new RegExp(PLACEHOLDER_SOURCE, 'g')
  for (const m of value.matchAll(re)) {
    const idx = m.index ?? 0
    if (idx > last) {
      out.push({ text: value.slice(last, idx), kind: 'plain' })
    }
    const field = m[1]!
    out.push({ text: m[0], kind: validKeys.value.has(field) ? 'known' : 'unknown' })
    last = idx + m[0].length
  }
  if (last < value.length) {
    out.push({ text: value.slice(last), kind: 'plain' })
  }
  return out
})

interface Ctx {
  mode: 'none' | 'bare' | 'mustache'
  partial: string
  openerAt?: number
  closerPresent?: boolean
  partialStart?: number
  partialEnd?: number
}

const ctx = ref<Ctx>({ mode: 'none', partial: '' })

function analyse(value: string, caret: number): Ctx {
  const before = value.slice(0, caret)
  const lastOpen = before.lastIndexOf('{{')
  if (lastOpen !== -1) {
    const between = before.slice(lastOpen + 2)
    if (!between.includes('}}')) {
      const partialMatch = between.match(/([a-zA-Z_][a-zA-Z0-9_]*)?$/)
      const partial = partialMatch ? partialMatch[0] : ''
      const partialStart = caret - partial.length
      const rest = value.slice(caret)
      const closerPresent = /^\s*\}\}/.test(rest)
      return {
        mode: 'mustache',
        partial,
        openerAt: lastOpen,
        closerPresent,
        partialStart,
        partialEnd: caret
      }
    }
  }
  if (value === '' || BARE_IDENT.test(value)) {
    return { mode: 'bare', partial: value }
  }
  return { mode: 'none', partial: '' }
}

const suggestions = computed<string[]>(() => {
  if (ctx.value.mode === 'none') return []
  const all = [...props.keys, ...(props.extraKeys ?? [])]
  const seen = new Set<string>()
  const dedup: string[] = []
  for (const k of all) {
    if (seen.has(k)) continue
    seen.add(k)
    dedup.push(k)
  }
  const q = ctx.value.partial.toLowerCase()
  const filtered = q
    ? dedup.filter(k => k.toLowerCase().includes(q))
    : dedup
  return filtered.slice(0, 12)
})

function refreshCtx() {
  const el = inputEl.value
  if (!el) return
  const caret = el.selectionStart ?? el.value.length
  ctx.value = analyse(el.value, caret)
  if (highlight.value >= suggestions.value.length) highlight.value = 0
  open.value = suggestions.value.length > 0 && ctx.value.mode !== 'none'
}

function onInput(e: Event) {
  const target = e.target as HTMLInputElement
  emit('update:modelValue', target.value)
  nextTick(() => {
    syncScroll()
    refreshCtx()
  })
}

function onFocus() {
  refreshCtx()
}

function onBlur() {
  setTimeout(() => {
    open.value = false
  }, 120)
}

function onKeydown(e: KeyboardEvent) {
  if (open.value && suggestions.value.length > 0) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      highlight.value = (highlight.value + 1) % suggestions.value.length
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      highlight.value = (highlight.value - 1 + suggestions.value.length) % suggestions.value.length
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      const pick = suggestions.value[highlight.value]
      if (pick) {
        e.preventDefault()
        applySuggestion(pick)
      }
      return
    }
    if (e.key === 'Escape') {
      open.value = false
      return
    }
  } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === ' ')) {
    refreshCtx()
  }

  if (e.key === '{') {
    const el = inputEl.value
    if (!el) return
    const caret = el.selectionStart ?? 0
    const before = el.value.slice(0, caret)
    if (before.endsWith('{')) {
      e.preventDefault()
      const after = el.value.slice(el.selectionEnd ?? caret)
      const next = `${before}{ }}${after}`
      emit('update:modelValue', next)
      nextTick(() => {
        const elNow = inputEl.value
        if (!elNow) return
        const cursor = before.length + 2 // after "{{ "
        elNow.setSelectionRange(cursor, cursor)
        syncScroll()
        refreshCtx()
      })
    }
  }
}

function applySuggestion(key: string) {
  const el = inputEl.value
  if (!el) return
  const value = props.modelValue ?? ''
  const chipText = `{{ ${key} }}`

  let next = value
  let nextCaret = 0

  if (ctx.value.mode === 'bare') {
    next = chipText
    nextCaret = next.length
  } else if (ctx.value.mode === 'mustache') {
    const pStart = ctx.value.partialStart ?? 0
    const pEnd = ctx.value.partialEnd ?? pStart
    const openerAt = ctx.value.openerAt ?? pStart
    const tail = value.slice(pEnd)
    const tailAfterCloser = ctx.value.closerPresent
      ? tail.replace(/^\s*\}\}/, '')
      : tail
    const head = value.slice(0, openerAt)
    next = head + chipText + tailAfterCloser
    nextCaret = head.length + chipText.length
  } else {
    return
  }

  emit('update:modelValue', next)
  nextTick(() => {
    const elNow = inputEl.value
    if (!elNow) return
    elNow.focus()
    elNow.setSelectionRange(nextCaret, nextCaret)
    syncScroll()
    refreshCtx()
  })
}

function syncScroll() {
  const input = inputEl.value
  const overlay = overlayEl.value
  if (!input || !overlay) return
  overlay.scrollLeft = input.scrollLeft
}

function onDocumentMouseDown(e: MouseEvent) {
  const host = inputEl.value?.parentElement
  if (!host) return
  if (!host.contains(e.target as Node)) {
    open.value = false
  }
}

onMounted(() => {
  if (import.meta.client) {
    document.addEventListener('mousedown', onDocumentMouseDown)
  }
})

onBeforeUnmount(() => {
  if (import.meta.client) {
    document.removeEventListener('mousedown', onDocumentMouseDown)
  }
})
</script>

<template>
  <div class="relative w-full">
    <input
      ref="inputEl"
      :value="modelValue"
      :placeholder="placeholder"
      type="text"
      class="field-input relative z-0 w-full rounded-md border border-default bg-default px-2.5 py-1.5 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
      autocomplete="off"
      spellcheck="false"
      @input="onInput"
      @focus="onFocus"
      @blur="onBlur"
      @keydown="onKeydown"
      @scroll="syncScroll"
    >

    <div
      ref="overlayEl"
      aria-hidden="true"
      class="field-overlay pointer-events-none absolute inset-0 z-10 overflow-hidden whitespace-pre rounded-md border border-transparent px-2.5 py-1.5 text-sm leading-6"
    >
      <span
        v-for="(s, i) in segments"
        :key="i"
        :class="{
          'text-highlighted': s.kind === 'plain',
          'text-primary font-medium': s.kind === 'known',
          'text-warning font-medium': s.kind === 'unknown'
        }"
      >{{ s.text }}</span>
    </div>

    <div
      v-if="open && suggestions.length > 0"
      class="absolute left-0 top-full z-20 mt-1 w-full rounded-md border border-default bg-default shadow-lg max-h-60 overflow-auto"
    >
      <button
        v-for="(s, i) in suggestions"
        :key="s"
        type="button"
        class="flex w-full items-center justify-between px-2.5 py-1.5 text-sm text-left hover:bg-elevated"
        :class="i === highlight ? 'bg-elevated' : ''"
        @mousedown.prevent="applySuggestion(s)"
        @mouseenter="highlight = i"
      >
        <span class="font-mono truncate">{{ s }}</span>
        <span class="text-[10px] text-muted uppercase tracking-wide">
          {{ ctx.mode === 'bare' ? 'field' : MUSTACHE_BADGE }}
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.field-input {
  color: transparent;
  caret-color: var(--ui-text-highlighted, var(--ui-text, #111));
}
.field-input::placeholder {
  color: var(--ui-text-muted, #94a3b8);
  opacity: 1;
}
.field-input::selection {
  color: transparent;
  background: color-mix(in srgb, var(--ui-primary, #3b82f6) 30%, transparent);
}
.text-highlighted {
  color: var(--ui-text-highlighted, var(--ui-text, currentColor));
}
</style>
