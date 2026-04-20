<template>
  <UApp>
    <NuxtLoadingIndicator />

    <div class="min-h-screen flex flex-col items-center justify-center bg-default px-4 py-10">
      <div class="w-full max-w-sm">
        <NuxtLink to="/" class="flex items-center justify-center gap-2 mb-8">
          <UIcon name="i-lucide-house" class="size-7 text-primary" />
          <span class="text-xl font-semibold text-highlighted">dp-reality</span>
        </NuxtLink>

        <slot />
      </div>
    </div>
  </UApp>
</template>
