<script setup lang="ts">
import * as z from 'zod'
import type { FormError, FormSubmitEvent } from '@nuxt/ui'

const passwordSchema = z.object({
  current: z.string().min(1, 'Current password required'),
  new: z.string().min(8, 'Must be at least 8 characters').max(128)
})

type PasswordSchema = z.output<typeof passwordSchema>

const password = reactive<Partial<PasswordSchema>>({ current: '', new: '' })
const saving = ref(false)
const deleting = ref(false)
const toast = useToast()
const { clear: clearSession } = useUserSession()
const { headers: csrfHeaders } = useCsrf()

const validate = (state: Partial<PasswordSchema>): FormError[] => {
  const errors: FormError[] = []
  if (state.current && state.new && state.current === state.new) {
    errors.push({ name: 'new', message: 'Passwords must be different' })
  }
  return errors
}

async function onSubmit(event: FormSubmitEvent<PasswordSchema>) {
  saving.value = true
  try {
    await $fetch('/api/auth/password', {
      method: 'POST',
      headers: csrfHeaders(),
      body: event.data
    })
    password.current = ''
    password.new = ''
    toast.add({ title: 'Password updated', color: 'success' })
  } catch (err: unknown) {
    const message
      = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || 'Could not update password'
    toast.add({ title: 'Update failed', description: message, color: 'error' })
  } finally {
    saving.value = false
  }
}

async function onDelete() {
  if (!confirm('Delete your account? This cannot be undone.')) return
  deleting.value = true
  try {
    await $fetch('/api/user', {
      method: 'DELETE',
      headers: csrfHeaders()
    })
    await clearSession()
    await navigateTo('/login')
  } catch {
    deleting.value = false
    toast.add({ title: 'Could not delete account', color: 'error' })
  }
}
</script>

<template>
  <UPageCard
    title="Password"
    description="Confirm your current password before setting a new one."
    variant="subtle"
  >
    <UForm
      :schema="passwordSchema"
      :state="password"
      :validate="validate"
      class="flex flex-col gap-4 max-w-xs"
      @submit="onSubmit"
    >
      <UFormField name="current">
        <UInput
          v-model="password.current"
          type="password"
          autocomplete="current-password"
          placeholder="Current password"
          class="w-full"
        />
      </UFormField>

      <UFormField name="new">
        <UInput
          v-model="password.new"
          type="password"
          autocomplete="new-password"
          placeholder="New password"
          class="w-full"
        />
      </UFormField>

      <UButton
        label="Update"
        type="submit"
        class="w-fit"
        :loading="saving"
      />
    </UForm>
  </UPageCard>

  <UPageCard
    title="Account"
    description="No longer want to use our service? You can delete your account here. This action is not reversible. All information related to this account will be deleted permanently."
    class="bg-linear-to-tl from-error/10 from-5% to-default"
  >
    <template #footer>
      <UButton
        label="Delete account"
        color="error"
        :loading="deleting"
        @click="onDelete"
      />
    </template>
  </UPageCard>
</template>
