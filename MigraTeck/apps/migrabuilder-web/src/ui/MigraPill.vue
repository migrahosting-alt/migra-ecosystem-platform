<template>
  <span :class="['migra-pill', tone === 'ok' ? 'migra-pill--ok' : '', tone === 'warn' ? 'migra-pill--warn' : '']">
    <slot />
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'neutral' | 'ok' | 'warn';
  }>(),
  { tone: 'neutral' }
);
</script>

