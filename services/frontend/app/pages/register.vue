<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  layout: 'auth',
  auth: { unauthenticatedOnly: true, navigateAuthenticatedTo: '/' }
})

useHead({ title: 'Create account' })

const schema = z.object({
  name: z.string().trim().min(2, 'Too short').max(80),
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(8, 'At least 8 characters').max(128)
})

type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ name: '', email: '', password: '' })
const loading = ref(false)
const toast = useToast()
const { fetch: refreshSession } = useUserSession()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    await $fetch('/api/auth/register', {
      method: 'POST',
      body: event.data
    })
    await refreshSession()
    toast.add({ title: 'Welcome!', description: 'Your account has been created.', color: 'success' })
    await navigateTo('/')
  } catch (err: unknown) {
    const message
      = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || 'Unable to register'
    toast.add({ title: 'Sign up failed', description: message, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-lg font-semibold text-highlighted">
        Create your account
      </h1>
      <p class="text-sm text-muted">
        Watch listings across sources and get email notifications that match your filters.
      </p>
    </template>

    <UForm
      :schema="schema"
      :state="state"
      class="flex flex-col gap-4"
      @submit="onSubmit"
    >
      <UFormField label="Name" name="name" required>
        <UInput
          v-model="state.name"
          autocomplete="name"
          class="w-full"
          placeholder="Jane Doe"
        />
      </UFormField>

      <UFormField label="Email" name="email" required>
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          class="w-full"
          placeholder="you@example.com"
        />
      </UFormField>

      <UFormField
        label="Password"
        name="password"
        hint="At least 8 characters"
        required
      >
        <UInput
          v-model="state.password"
          type="password"
          autocomplete="new-password"
          class="w-full"
          placeholder="••••••••"
        />
      </UFormField>

      <UButton
        type="submit"
        label="Create account"
        block
        :loading="loading"
      />
    </UForm>

    <template #footer>
      <p class="text-sm text-muted text-center">
        Already have an account?
        <NuxtLink to="/login" class="text-primary hover:underline">
          Sign in
        </NuxtLink>
      </p>
    </template>
  </UCard>
</template>
