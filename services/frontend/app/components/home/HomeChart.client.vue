<script setup lang="ts">
import { format, parseISO } from 'date-fns'
import { VisXYContainer, VisLine, VisAxis, VisArea, VisCrosshair, VisTooltip } from '@unovis/vue'
import type { Period, Range } from '~~/shared/types'

const cardRef = useTemplateRef<HTMLElement | null>('cardRef')

const props = defineProps<{
  period: Period
  range: Range
}>()

interface SeriesPoint {
  bucket: string
  count: number
}

type DataRecord = {
  date: Date
  label: string
  count: number
}

const { width } = useElementSize(cardRef)

const { data: seriesData } = await useFetch<SeriesPoint[]>(
  '/api/stats/listings-series',
  {
    default: () => [],
    query: computed(() => ({
      start: props.range.start.toISOString(),
      end: props.range.end.toISOString(),
      period: props.period
    })),
    watch: [() => props.period, () => props.range]
  }
)

const data = computed<DataRecord[]>(() => {
  return seriesData.value.map((point) => {
    const date = parseBucket(point.bucket, props.period)
    return {
      date,
      label: formatLabel(date, props.period),
      count: point.count
    }
  })
})

function parseBucket(bucket: string, period: Period): Date {
  if (period === 'daily') {
    return parseISO(bucket)
  }
  if (period === 'monthly') {
    return parseISO(`${bucket}-01`)
  }
  // weekly: '%G-W%V'
  const [year, week] = bucket.split('-W')
  if (year && week) {
    // ISO week date format YYYY-Www-1 (Monday)
    const iso = `${year}-W${week.padStart(2, '0')}-1`
    return parseISO(iso)
  }
  return new Date(bucket)
}

function formatLabel(date: Date, period: Period): string {
  if (period === 'monthly') return format(date, 'MMM yyyy')
  return format(date, 'd MMM')
}

const x = (_: DataRecord, i: number) => i
const y = (d: DataRecord) => d.count

const total = computed(() => data.value.reduce((acc, { count }) => acc + count, 0))

const formatNumber = new Intl.NumberFormat('en').format

const xTicks = (i: number) => {
  if (i === 0 || i === data.value.length - 1 || !data.value[i]) {
    return ''
  }
  return data.value[i].label
}

const template = (d: DataRecord) => `${d.label}: ${formatNumber(d.count)}`
</script>

<template>
  <UCard ref="cardRef" :ui="{ root: 'overflow-visible', body: 'px-0! pt-0! pb-3!' }">
    <template #header>
      <div>
        <p class="text-xs text-muted uppercase mb-1.5">
          New listings
        </p>
        <p class="text-3xl text-highlighted font-semibold">
          {{ formatNumber(total) }}
        </p>
      </div>
    </template>

    <VisXYContainer
      :data="data"
      :padding="{ top: 40 }"
      class="h-96"
      :width="width"
    >
      <VisLine
        :x="x"
        :y="y"
        color="var(--ui-primary)"
      />
      <VisArea
        :x="x"
        :y="y"
        color="var(--ui-primary)"
        :opacity="0.1"
      />

      <VisAxis
        type="x"
        :x="x"
        :tick-format="xTicks"
      />

      <VisCrosshair
        color="var(--ui-primary)"
        :template="template"
      />

      <VisTooltip />
    </VisXYContainer>
  </UCard>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: var(--ui-primary);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
