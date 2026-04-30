<template>
  <div class="migra-widget migra-widget--counter">
    <div class="text-3xl font-black" :style="{ color: color }">
      <span v-if="prefix">{{ prefix }}</span>{{ start }}<span v-if="suffix">{{ suffix }}</span>
    </div>
    <div v-if="title" class="text-sm migra-muted mt-1">{{ title }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const title = computed(() => String((props.node.props as any)?.title || '').trim());
const prefix = computed(() => String((props.node.props as any)?.prefix || '').trim());
const suffix = computed(() => String((props.node.props as any)?.suffix || '').trim());
const start = computed(() => Number((props.node.props as any)?.start ?? 0));
const color = computed(() => String((props.node.props as any)?.color || 'var(--migra-text)'));
</script>

