<template>
  <div class="migra-widget migra-widget--container" :style="style">
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const style = computed(() => {
  const p: any = props.node.props || {};
  const gap = Number(p.gap ?? 20);
  const bg = String(p.background_color || '').trim();

  const base: Record<string, string> = {
    display: 'flex',
    flexDirection: 'column',
    gap: `${Number.isFinite(gap) ? gap : 20}px`,
    paddingTop: `${Number(p.padding_top ?? 0)}px`,
    paddingRight: `${Number(p.padding_right ?? 0)}px`,
    paddingBottom: `${Number(p.padding_bottom ?? 0)}px`,
    paddingLeft: `${Number(p.padding_left ?? 0)}px`,
  };

  if (bg) base.backgroundColor = bg;
  return base;
});
</script>

