<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ModuleDoc, NotificationField } from '~~/shared/types'
import { apply as applyNotification } from '~~/shared/notify'

interface ModuleFormPayload {
  name: string
  collection: string
  source: string
  description: string
  configSchema: Record<string, unknown>
  notification: {
    subject: string
    title: string
    url: string
    fields: NotificationField[]
  }
  code: string | null
}

const props = withDefaults(defineProps<{
  initial?: ModuleDoc | null
  submitLabel?: string
  lockIdentity?: boolean
  lockCode?: boolean
  busy?: boolean
}>(), {
  initial: null,
  submitLabel: 'Upload',
  lockIdentity: false,
  lockCode: false,
  busy: false
})

const emit = defineEmits<{
  (e: 'submit', payload: ModuleFormPayload): void
  (e: 'cancel'): void
}>()

const MAX_CODE_BYTES = 1_048_576
const MAX_DESC_BYTES = 32_768
const MAX_SCHEMA_BYTES = 16 * 1024

const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,62}$/
const SOURCE_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateConfigSchemaJson(raw: string): { ok: boolean, parsed?: Record<string, unknown>, error?: string } {
  if (new TextEncoder().encode(raw).byteLength > MAX_SCHEMA_BYTES) {
    return { ok: false, error: `Schema exceeds ${Math.round(MAX_SCHEMA_BYTES / 1024)} KB` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { ok: false, error: `Not valid JSON: ${(err as Error).message}` }
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: 'Schema must be a JSON object' }
  }
  if (parsed.type !== undefined && parsed.type !== 'object') {
    return { ok: false, error: 'Root `type` must be "object"' }
  }
  return { ok: true, parsed }
}

const notificationSchema = z.object({
  subject: z.string().max(512),
  title: z.string().max(512),
  url: z.string().max(512),
  fields: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    value: z.string().max(512)
  })).max(16)
})

const schema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  collection: z.string().regex(COLLECTION_PATTERN, {
    message: 'Lowercase letters, digits or `_`; must start with a letter'
  }),
  source: z.string().regex(SOURCE_PATTERN, {
    message: 'Lowercase letters, digits or `_`; must start with a letter'
  }),
  description: z.string().max(MAX_DESC_BYTES).optional().default(''),
  config_schema_json: z.string().refine(
    raw => validateConfigSchemaJson(raw).ok,
    { message: 'Config schema must be a valid JSON Schema object' }
  ),
  notification_subject: z.string().max(512),
  notification_title: z.string().min(1, 'Title is required').max(512),
  notification_url: z.string().min(1, 'URL is required').max(512),
  code: z.string().optional()
})
type Schema = z.output<typeof schema>

const DEFAULT_CONFIG_SCHEMA_JSON = JSON.stringify({
  type: 'object',
  additionalProperties: false,
  required: ['url'],
  properties: {
    url: { type: 'string', format: 'uri', maxLength: 2048 }
  }
}, null, 2)

function initialState(): Partial<Schema> {
  if (props.initial) {
    return {
      name: props.initial.name,
      collection: props.initial.collection,
      source: props.initial.source,
      description: props.initial.description,
      config_schema_json: JSON.stringify(props.initial.configSchema, null, 2),
      notification_subject: props.initial.notification.subject,
      notification_title: props.initial.notification.title || 'title',
      notification_url: props.initial.notification.url || 'url',
      code: ''
    }
  }
  return {
    name: '',
    collection: '',
    source: '',
    description: '',
    config_schema_json: DEFAULT_CONFIG_SCHEMA_JSON,
    notification_subject: 'New matches ({{count}})',
    notification_title: 'title',
    notification_url: 'url',
    code: ''
  }
}

const state = reactive<Partial<Schema>>(initialState())

const notificationFields = ref<NotificationField[]>(
  props.initial?.notification?.fields?.length
    ? props.initial.notification.fields.map(f => ({ ...f }))
    : [
        { label: 'Title', value: '{{ title }}' },
        { label: 'Price', value: '{{ price }}' }
      ]
)

function addNotificationField() {
  notificationFields.value.push({ label: '', value: '' })
}
function removeNotificationField(i: number) {
  notificationFields.value.splice(i, 1)
}

const fileName = ref('')
const toast = useToast()
const sdkDocs = useSdkDocs()

const isEdit = computed(() => props.initial != null)

// Vue's mustache parser can't tolerate nested {{ }} inline in templates.
const EX_TEMPLATE = '{{ price }} CZK {{ price_type }}'

interface SampleResponse {
  found: boolean
  keys: string[]
  sample: Record<string, unknown> | null
}

const sampleKeys = ref<string[]>([])
const sampleDoc = ref<Record<string, unknown>>({})
const sampleLoading = ref(false)
const sampleError = ref<string | null>(null)

async function fetchSample() {
  if (!state.collection) return
  sampleLoading.value = true
  sampleError.value = null
  try {
    const res = await $fetch<SampleResponse>(
      `/api/collections/${encodeURIComponent(state.collection)}/sample`,
      { query: { authoring: 1 } }
    )
    if (!res.found) {
      sampleError.value = 'Collection is empty — keys will be available once the scraper has written something.'
      sampleKeys.value = []
      sampleDoc.value = {}
      return
    }
    sampleKeys.value = res.keys
    sampleDoc.value = res.sample ?? {}
  } catch (err) {
    const message = (err as { data?: { message?: string }, message?: string }).data?.message
      ?? (err as Error).message
      ?? 'Fetch failed'
    sampleError.value = message
  } finally {
    sampleLoading.value = false
  }
}

onMounted(() => {
  if (isEdit.value && state.collection) {
    void fetchSample()
  }
})

const previewSpec = computed(() => ({
  subject: state.notification_subject ?? '',
  title: state.notification_title ?? '',
  url: state.notification_url ?? '',
  fields: notificationFields.value
}))

const previewRow = computed(() => {
  const doc = Object.keys(sampleDoc.value).length > 0
    ? sampleDoc.value
    : { title: '<example title>', url: 'https://example.com/123', city: 'Brno', price: 4200000, price_type: 'sale' }
  return applyNotification(previewSpec.value, doc)
})

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) {
    state.code = ''
    fileName.value = ''
    return
  }
  if (file.size > MAX_CODE_BYTES) {
    toast.add({ title: 'File exceeds 1 MB', color: 'error' })
    input.value = ''
    state.code = ''
    fileName.value = ''
    return
  }
  state.code = await file.text()
  fileName.value = file.name
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const schemaCheck = validateConfigSchemaJson(event.data.config_schema_json)
  if (!schemaCheck.ok || !schemaCheck.parsed) {
    toast.add({ title: 'Invalid config schema', description: schemaCheck.error, color: 'error' })
    return
  }

  let notification: ModuleFormPayload['notification']
  try {
    notification = notificationSchema.parse({
      subject: event.data.notification_subject,
      title: event.data.notification_title,
      url: event.data.notification_url,
      fields: notificationFields.value.filter(f => f.label.trim() && f.value.trim())
    })
  } catch (err) {
    const issues = (err as z.ZodError).issues?.map(i => i.message).join(', ') ?? 'Invalid notification spec'
    toast.add({ title: 'Invalid notification spec', description: issues, color: 'error' })
    return
  }

  emit('submit', {
    name: event.data.name,
    collection: event.data.collection,
    source: event.data.source,
    description: event.data.description ?? '',
    configSchema: schemaCheck.parsed,
    notification,
    code: event.data.code ? event.data.code : null
  })
}

const submitDisabled = computed(() => !isEdit.value && !state.code)
</script>

<template>
  <div class="flex flex-col lg:flex-row gap-6">
    <div class="w-full lg:w-auto lg:max-w-2xl lg:shrink-0 min-w-0">
      <UForm
        :schema="schema"
        :state="state"
        class="flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
          description="Displayed on the modules page and the bot list."
        >
          <UInput v-model="state.name" class="w-full" />
        </UFormField>

        <UFormField
          label="Collection"
          name="collection"
          required
          description="MongoDB collection this module's bots query. Use `reality` for listings, or pick a dedicated collection if your bot tracks something else (e.g. `dom_changes`). Your scraper must write into the same collection."
        >
          <div class="flex items-center gap-2">
            <UInput
              v-model="state.collection"
              class="flex-1"
              placeholder="reality"
              :disabled="lockIdentity"
            />
            <UButton
              label="Fetch sample"
              color="neutral"
              variant="outline"
              :loading="sampleLoading"
              :disabled="!state.collection"
              @click="fetchSample"
            />
          </div>
          <p v-if="sampleError" class="text-xs text-warning mt-1">
            {{ sampleError }}
          </p>
          <p v-else-if="sampleKeys.length > 0" class="text-xs text-muted mt-1">
            Available fields:
            <code class="text-xs">{{ sampleKeys.join(', ') }}</code>
          </p>
        </UFormField>

        <UFormField
          label="Source"
          name="source"
          required
          description="Identifier of the scraper that feeds this module's collection (e.g. `bazos`, `sreality`). Must match what the scraper sets as `source` on every listing it inserts."
        >
          <UInput
            v-model="state.source"
            class="w-full"
            placeholder="bazos"
            :disabled="lockIdentity"
          />
        </UFormField>

        <UFormField
          label="Description (markdown)"
          name="description"
          :description="`Rendered on the module card and as a side panel on the bot configuration page. Supports full markdown (headings, tables, fenced code, links). Up to ${Math.round(MAX_DESC_BYTES / 1024)} KB.`"
        >
          <UTextarea v-model="state.description" class="w-full font-mono text-xs" :rows="8" />
        </UFormField>

        <UFormField
          label="Config schema (JSON Schema)"
          name="config_schema_json"
          required
          description="JSON Schema used to validate the `config` your bundle's `saveBot` payload. The server rejects any bot whose config doesn't match this. Each bundle is responsible for composing the matcher from that config itself."
        >
          <UTextarea v-model="state.config_schema_json" class="w-full font-mono text-xs" :rows="14" />
        </UFormField>

        <div class="rounded-md border border-default p-4 flex flex-col gap-4">
          <div>
            <h3 class="text-sm font-semibold">
              Notification spec
            </h3>
            <p class="text-xs text-muted mt-1">
              Names the listing fields that go into each email slot. Use a bare field name
              (<code>title</code>) or a templated expression
              (<code>{{ EX_TEMPLATE }}</code>). Missing values render empty;
              rows with empty values are hidden. The notification service owns the HTML chrome —
              this spec only drives the slots.
            </p>
          </div>

          <div class="flex flex-col gap-3">
            <p class="text-xs font-semibold uppercase tracking-wide text-muted">
              Email envelope
            </p>

            <UFormField
              label="Subject"
              name="notification_subject"
              description="Email subject. Supports `count` (number of listings) plus any field."
            >
              <ModulesFieldAutocomplete
                :model-value="state.notification_subject ?? ''"
                :keys="sampleKeys"
                :extra-keys="['count']"
                @update:model-value="state.notification_subject = $event"
              />
            </UFormField>
          </div>

          <div class="rounded-md border border-default bg-elevated/30 p-3 flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold uppercase tracking-wide text-muted">
                  Per-listing row
                </p>
                <p class="text-xs text-muted mt-0.5">
                  One card gets rendered in the email for every matched listing, using the slots below.
                </p>
              </div>
            </div>

            <UFormField
              label="Title"
              name="notification_title"
              required
              description="Linked heading of each row. Must resolve to something non-empty — rows with an empty title are skipped."
            >
              <ModulesFieldAutocomplete
                :model-value="state.notification_title ?? ''"
                :keys="sampleKeys"
                @update:model-value="state.notification_title = $event"
              />
            </UFormField>

            <UFormField
              label="URL"
              name="notification_url"
              required
              description="Destination of the title link. Must resolve to something non-empty."
            >
              <ModulesFieldAutocomplete
                :model-value="state.notification_url ?? ''"
                :keys="sampleKeys"
                @update:model-value="state.notification_url = $event"
              />
            </UFormField>

            <div class="border-t border-default pt-3">
              <div class="flex items-center justify-between mb-2">
                <p class="text-sm font-medium">
                  Labeled rows
                </p>
                <UButton
                  icon="i-lucide-plus"
                  label="Add row"
                  size="xs"
                  color="neutral"
                  variant="outline"
                  @click="addNotificationField"
                />
              </div>
              <p class="text-xs text-muted mb-2">
                Optional extra lines under the title. Rows whose resolved value is empty are hidden automatically.
              </p>

              <div v-if="notificationFields.length === 0" class="text-xs text-muted italic">
                No labeled rows — the listing card will show only the title link.
              </div>
              <div v-else class="flex flex-col gap-2">
                <div
                  v-for="(field, i) in notificationFields"
                  :key="i"
                  class="flex items-start gap-2"
                >
                  <UInput
                    v-model="field.label"
                    placeholder="Label"
                    class="w-40 shrink-0"
                  />
                  <ModulesFieldAutocomplete
                    :model-value="field.value"
                    :keys="sampleKeys"
                    placeholder="field or {{ field }}"
                    class="flex-1"
                    @update:model-value="field.value = $event"
                  />
                  <UButton
                    icon="i-lucide-x"
                    size="sm"
                    color="neutral"
                    variant="ghost"
                    @click="removeNotificationField(i)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <UFormField
          v-if="!lockCode"
          label="Bundle (.mjs)"
          name="code"
          :required="!isEdit"
          :description="isEdit
            ? 'Optional — leave empty to keep the existing bundle. Max 1 MB.'
            : 'A pre-built ESM module exporting a factory as its default export. Max 1 MB.'"
        >
          <div class="flex items-center gap-3">
            <UButton
              as="label"
              icon="i-lucide-upload"
              color="neutral"
              variant="outline"
              label="Choose file"
            >
              <input
                type="file"
                accept=".mjs,.js,text/javascript"
                class="hidden"
                @change="onFileChange"
              >
            </UButton>
            <span class="text-sm text-muted truncate">
              {{ fileName || (isEdit ? 'Keep existing bundle' : 'No file selected') }}
            </span>
          </div>
        </UFormField>

        <div class="flex items-center gap-2">
          <UButton
            type="submit"
            :label="submitLabel"
            :loading="busy"
            :disabled="submitDisabled"
          />
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="emit('cancel')"
          />
        </div>
      </UForm>

      <UAlert
        v-if="!isEdit"
        class="mt-6"
        icon="i-lucide-shield-alert"
        color="warning"
        variant="soft"
        title="POC trust model"
        description="Module code runs in every other signed-in user's browser when they open it. Only upload modules you trust."
      />
      <UAlert
        v-else-if="lockCode"
        class="mt-6"
        icon="i-lucide-info"
        color="info"
        variant="soft"
        title="System module"
        description="The .mjs bundle of this module is developer-owned — it's re-upserted from the repo on every server restart. You can freely iterate on the notification layout, description and config schema here; those edits persist across restarts."
      />
      <UAlert
        v-else
        class="mt-6"
        icon="i-lucide-info"
        color="info"
        variant="soft"
        title="Editing existing module"
        description="Edits do not retro-apply to bots already created from this module — they keep their original matcher/notification snapshot. Only future bots see your changes."
      />
    </div>

    <div class="flex flex-col gap-4 flex-1 min-w-0">
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-semibold">
              Notification preview
            </h3>
            <span class="text-xs text-muted">
              {{ Object.keys(sampleDoc).length > 0 ? 'using fetched sample' : 'placeholder sample' }}
            </span>
          </div>
        </template>

        <div v-if="previewRow" class="rounded-md border border-default p-3">
          <a
            :href="previewRow.url"
            target="_blank"
            class="font-semibold text-primary block truncate"
          >{{ previewRow.title }}</a>
          <div
            v-for="(f, i) in previewRow.fields"
            :key="i"
            class="text-xs text-muted mt-1"
          >
            <strong>{{ f.label }}:</strong> {{ f.value }}
          </div>
        </div>
        <div v-else class="text-xs text-muted">
          Title or URL resolve empty with the current sample. The
          notification would be skipped. Fix the spec or fetch a
          sample that has those fields.
        </div>
      </UCard>

      <MarkdownPanel
        variant="side"
        title="SDK reference"
        :source="sdkDocs"
      />
    </div>
  </div>
</template>
