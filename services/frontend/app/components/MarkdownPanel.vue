<script setup lang="ts">
import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Renders markdown as a right-side documentation panel.
 *
 * - `variant="side"`: a sticky aside for the left-over horizontal space.
 *   Hidden below `lg`.
 * - `variant="trigger"`: a small button that opens a slideover with the
 *   rendered markdown. Hidden on `lg+`.
 * - `variant="both"`: side panel on large screens AND the mobile trigger
 *   on small screens.
 *
 * Typical usage: `trigger` in the navbar right slot + `side` in the body.
 */
const props = withDefaults(defineProps<{
  title: string
  source: string
  variant?: 'side' | 'trigger' | 'both'
  sticky?: boolean
}>(), { variant: 'both', sticky: true })

const mobileOpen = ref(false)

const rendered = computed<string>(() => {
  const raw = props.source?.trim().length ? props.source : '*No documentation provided.*'
  const html = marked.parse(raw, { async: false }) as string
  if (import.meta.server) return html
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
})

const proseCls = 'prose prose-sm dark:prose-invert max-w-none'
  + ' prose-headings:font-semibold prose-headings:mt-4 prose-headings:mb-2'
  + ' prose-p:my-2 prose-pre:bg-elevated prose-pre:text-xs prose-pre:p-3 prose-pre:rounded-md'
  + ' prose-code:before:content-[""] prose-code:after:content-[""] prose-code:bg-elevated prose-code:px-1 prose-code:py-0.5 prose-code:rounded'
  + ' prose-a:text-primary'

const showSide = computed(() => props.variant === 'side' || props.variant === 'both')
const showTrigger = computed(() => props.variant === 'trigger' || props.variant === 'both')

const sideCls = computed(() => [
  'hidden lg:flex lg:flex-col flex-1 min-w-0 border-default lg:border-l lg:pl-6',
  props.sticky ? 'lg:sticky lg:top-4 lg:self-start' : ''
].filter(Boolean).join(' '))

const triggerCls = 'lg:hidden'
</script>

<template>
  <aside v-if="showSide" :class="sideCls">
    <h2 class="text-sm font-semibold mb-3 flex items-center gap-2">
      <UIcon name="i-lucide-book-open" class="size-4" />
      {{ title }}
    </h2>
    <!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify -->
    <div :class="proseCls" v-html="rendered" />
  </aside>

  <div v-if="showTrigger" :class="triggerCls">
    <UButton
      icon="i-lucide-book-open"
      color="neutral"
      variant="outline"
      size="sm"
      :label="title"
      @click="mobileOpen = true"
    />

    <USlideover v-model:open="mobileOpen" :title="title" side="right">
      <template #body>
        <!-- eslint-disable-next-line vue/no-v-html -- sanitized by DOMPurify -->
        <div :class="proseCls" v-html="rendered" />
      </template>
    </USlideover>
  </div>
</template>
