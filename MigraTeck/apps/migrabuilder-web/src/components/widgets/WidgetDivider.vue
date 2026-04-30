<template>
  <div class="migra-widget migra-widget--divider" :style="{ textAlign: align }">
    <hr :style="style" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const align = computed(() => String((props.node.props as any)?.align || 'center') as 'left' | 'center' | 'right');

const style = computed(() => {
  const p: any = props.node.props || {};
  const weight = Number(p.weight ?? 1);
  const width = Number(p.width ?? 100);
  const color = String(p.color || '#e2e8f0');
  const borderStyle = String(p.style || 'solid');

  return {
    border: 'none',
    borderTop: `${Number.isFinite(weight) ? weight : 1}px ${borderStyle} ${color}`,
    width: `${Number.isFinite(width) ? width : 100}%`,
    margin: align.value === 'left' ? '0 auto 0 0' : align.value === 'right' ? '0 0 0 auto' : '0 auto',
  } as any;
});
</script>

