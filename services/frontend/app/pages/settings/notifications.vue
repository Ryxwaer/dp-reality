<script setup lang="ts">
interface Preferences {
  email_enabled: boolean
  weekly_digest: boolean
  important_updates: boolean
}

const toast = useToast()

const { data: profile } = await useFetch('/api/user', {
  default: () => ({
    id: '',
    email: '',
    name: '',
    created_at: '',
    preferences: {
      email_enabled: true,
      weekly_digest: false,
      important_updates: true
    } as Preferences
  })
})

const state = reactive<Preferences>({
  email_enabled: profile.value.preferences.email_enabled,
  weekly_digest: profile.value.preferences.weekly_digest,
  important_updates: profile.value.preferences.important_updates
})

watch(profile, (next) => {
  state.email_enabled = next.preferences.email_enabled
  state.weekly_digest = next.preferences.weekly_digest
  state.important_updates = next.preferences.important_updates
})

const sections = [{
  title: 'Notification channels',
  description: 'Where should we send matched listings?',
  fields: [{
    name: 'email_enabled' as const,
    label: 'Email',
    description: 'Receive matched listings by email.'
  }]
}, {
  title: 'Account updates',
  description: 'Extra emails from dp-reality.',
  fields: [{
    name: 'weekly_digest' as const,
    label: 'Weekly digest',
    description: 'A weekly summary of all new matches from the past 7 days.'
  }, {
    name: 'important_updates' as const,
    label: 'Important updates',
    description: 'Security fixes, maintenance and account-critical notices.'
  }]
}]

async function onChange() {
  try {
    await $fetch('/api/user/preferences', { method: 'PATCH', body: state })
    toast.add({ title: 'Preferences saved', color: 'success' })
  } catch {
    toast.add({ title: 'Could not save preferences', color: 'error' })
  }
}
</script>

<template>
  <div v-for="(section, index) in sections" :key="index">
    <UPageCard
      :title="section.title"
      :description="section.description"
      variant="naked"
      class="mb-4"
    />

    <UPageCard variant="subtle" :ui="{ container: 'divide-y divide-default' }">
      <UFormField
        v-for="field in section.fields"
        :key="field.name"
        :name="field.name"
        :label="field.label"
        :description="field.description"
        class="flex items-center justify-between not-last:pb-4 gap-2"
      >
        <USwitch
          v-model="state[field.name]"
          @update:model-value="onChange"
        />
      </UFormField>
    </UPageCard>
  </div>
</template>
