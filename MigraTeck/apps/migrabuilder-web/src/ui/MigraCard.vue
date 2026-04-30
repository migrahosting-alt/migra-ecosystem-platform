<template>
  <section class="migra-card">
    <header v-if="hasHeader" class="migra-card__header">
      <div class="migra-card__heading">
        <div v-if="eyebrow" class="migra-card__eyebrow">{{ eyebrow }}</div>
        <div v-if="title" class="migra-card__title">{{ title }}</div>
        <div v-if="subtitle" class="migra-card__subtitle">{{ subtitle }}</div>
      </div>
      <div v-if="$slots.actions" class="migra-row">
        <slot name="actions" />
      </div>
    </header>
    <div class="migra-card__body">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  eyebrow?: string;
  title?: string;
  subtitle?: string;
}>();

const hasHeader = computed(() => Boolean(props.eyebrow || props.title || props.subtitle));
</script>

