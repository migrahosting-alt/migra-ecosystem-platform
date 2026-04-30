<template>
  <div class="migra-widget migra-widget--progress">
    <div class="flex items-center justify-between gap-3">
      <div class="text-sm font-semibold">{{ title || 'Progress' }}</div>
      <div class="text-xs migra-muted">{{ percent }}%</div>
    </div>
    <div class="migra-progress-bar mt-2">
      <div class="migra-progress-fill" :style="{ width: `${percent}%`, backgroundColor: color }" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const title = computed(() => String((props.node.props as any)?.title || '').trim());
const percent = computed(() => {
  const p = Number((props.node.props as any)?.percent ?? 50);
  return Math.max(0, Math.min(100, Number.isFinite(p) ? p : 50));
});
const color = computed(() => String((props.node.props as any)?.color || 'var(--migra-accent)'));
</script>

