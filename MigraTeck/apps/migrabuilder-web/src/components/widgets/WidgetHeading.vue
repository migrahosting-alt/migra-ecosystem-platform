<template>
  <component :is="tag" class="migra-widget migra-widget--heading" :style="style">
    {{ text }}
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const tag = computed(() => {
  const t = String((props.node.props as any)?.tag || 'h2').toLowerCase();
  return ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(t) ? t : 'h2';
});

const text = computed(() => String((props.node.props as any)?.title || (props.node.props as any)?.text || 'Heading'));

const style = computed(() => {
  const p: any = props.node.props || {};
  const letterSpacing = p.letter_spacing != null ? Number(p.letter_spacing) : 0;
  const lineHeight = p.line_height != null ? Number(p.line_height) : undefined;

  const base: Record<string, string> = {
    margin: '0',
    color: String(p.color || 'var(--migra-text)'),
    textAlign: String(p.align || 'left'),
    fontSize: `${Number(p.font_size ?? 28)}px`,
    fontWeight: String(p.font_weight ?? '800'),
    paddingTop: `${Number(p.padding_top ?? 0)}px`,
    paddingRight: `${Number(p.padding_right ?? 0)}px`,
    paddingBottom: `${Number(p.padding_bottom ?? 0)}px`,
    paddingLeft: `${Number(p.padding_left ?? 0)}px`,
  };

  if (Number.isFinite(letterSpacing)) base.letterSpacing = `${letterSpacing}px`;
  if (lineHeight != null && Number.isFinite(lineHeight)) base.lineHeight = String(lineHeight);

  return base;
});
</script>

