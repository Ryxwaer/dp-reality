<script setup lang="ts">
defineProps<{
  collapsed?: boolean
}>()

const brand = {
  label: 'dp-reality',
  icon: 'i-lucide-house'
}
</script>

<template>
  <NuxtLink to="/" class="block">
    <UButton
      :label="collapsed ? undefined : brand.label"
      :icon="brand.icon"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      :class="[!collapsed && 'py-2 justify-start']"
    />
  </NuxtLink>
</template>
