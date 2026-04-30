<template>
  <span :class="['migra-badge', tone === 'accent' ? 'migra-badge--accent' : '']">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'accent';
  }>(),
  { tone: 'neutral' }
);
</script>

