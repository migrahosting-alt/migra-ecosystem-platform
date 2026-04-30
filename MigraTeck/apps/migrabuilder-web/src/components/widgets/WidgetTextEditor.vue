<template>
  <div class="migra-widget migra-widget--text" :style="style">
    <div class="migra-widget__text" style="white-space: pre-wrap;">{{ text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const text = computed(() => String((props.node.props as any)?.editor || 'Add your text here…'));

const style = computed(() => {
  const p: any = props.node.props || {};
  return {
    textAlign: String(p.align || 'left') as 'left' | 'center' | 'right',
    color: String(p.color || 'var(--migra-text)'),
  };
});
</script>

