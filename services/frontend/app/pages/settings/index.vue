<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

const profileSchema = z.object({
  name: z.string().trim().min(2, 'Too short').max(80),
  email: z.string().trim().toLowerCase().email('Invalid email')
})

type ProfileSchema = z.output<typeof profileSchema>

const toast = useToast()
const { fetch: refreshSession } = useUserSession()
const { headers: csrfHeaders } = useCsrf()

const { data: profile, refresh } = await useFetch('/api/user', {
  default: () => ({ id: '', email: '', name: '', created_at: '', preferences: {
    email_enabled: true,
    weekly_digest: false,
    important_updates: true
  } })
})

const state = reactive<Partial<ProfileSchema>>({
  name: profile.value.name,
  email: profile.value.email
})

watch(profile, (next) => {
  state.name = next.name
  state.email = next.email
})

const saving = ref(false)

async function onSubmit(event: FormSubmitEvent<ProfileSchema>) {
  saving.value = true
  try {
    await $fetch('/api/user', {
      method: 'PATCH',
      headers: csrfHeaders(),
      body: event.data
    })
    await Promise.all([refresh(), refreshSession()])
    toast.add({
      title: 'Profile updated',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (err: unknown) {
    const message
      = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || 'Unable to save changes'
    toast.add({ title: 'Update failed', description: message, color: 'error' })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UForm
    id="settings"
    :schema="profileSchema"
    :state="state"
    @submit="onSubmit"
  >
    <UPageCard
      title="Profile"
      description="Your account information used for login and email notifications."
      variant="naked"
      orientation="horizontal"
      class="mb-4"
    >
      <UButton
        form="settings"
        label="Save changes"
        color="neutral"
        type="submit"
        :loading="saving"
        class="w-fit lg:ms-auto"
      />
    </UPageCard>

    <UPageCard variant="subtle">
      <UFormField
        name="name"
        label="Name"
        description="Used inside the app and in notification emails."
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput v-model="state.name" autocomplete="name" />
      </UFormField>
      <USeparator />
      <UFormField
        name="email"
        label="Email"
        description="Where matched listings get delivered."
        required
        class="flex max-sm:flex-col justify-between items-start gap-4"
      >
        <UInput v-model="state.email" type="email" autocomplete="email" />
      </UFormField>
    </UPageCard>
  </UForm>
</template>
