<script setup lang="ts">
import * as z from 'zod'
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({
  layout: 'auth',
  auth: { unauthenticatedOnly: true, navigateAuthenticatedTo: '/' }
})

useHead({ title: 'Sign in' })

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(1, 'Required')
})

type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({ email: '', password: '' })
const loading = ref(false)
const toast = useToast()
const { fetch: refreshSession } = useUserSession()

async function onSubmit(event: FormSubmitEvent<Schema>) {
  loading.value = true
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: event.data
    })
    await refreshSession()
    await navigateTo('/')
  } catch (err: unknown) {
    const message
      = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
        || 'Unable to sign in'
    toast.add({ title: 'Sign in failed', description: message, color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UCard>
    <template #header>
      <h1 class="text-lg font-semibold text-highlighted">
        Welcome back
      </h1>
      <p class="text-sm text-muted">
        Sign in to keep track of your bots and matches.
      </p>
    </template>

    <UForm
      :schema="schema"
      :state="state"
      class="flex flex-col gap-4"
      @submit="onSubmit"
    >
      <UFormField label="Email" name="email" required>
        <UInput
          v-model="state.email"
          type="email"
          autocomplete="email"
          class="w-full"
          placeholder="you@example.com"
        />
      </UFormField>

      <UFormField label="Password" name="password" required>
        <UInput
          v-model="state.password"
          type="password"
          autocomplete="current-password"
          class="w-full"
          placeholder="••••••••"
        />
      </UFormField>

      <UButton
        type="submit"
        label="Sign in"
        block
        :loading="loading"
      />
    </UForm>

    <template #footer>
      <p class="text-sm text-muted text-center">
        Don&rsquo;t have an account?
        <NuxtLink to="/register" class="text-primary hover:underline">
          Create one
        </NuxtLink>
      </p>
    </template>
  </UCard>
</template>
