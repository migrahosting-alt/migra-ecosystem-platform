<template>
  <component
    v-if="Comp"
    :is="Comp"
    :node="node"
  >
    <slot />
  </component>

  <div v-else class="migra-unknown">
    <div class="text-sm font-semibold">{{ node.type }}</div>
    <div class="text-xs migra-muted">No renderer yet. Use Navigator to move/delete.</div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Component } from 'vue';
import type { DocNode } from '@/core/document';
import { getWidgetRenderer } from '@/core/widgetRegistry';

const props = defineProps<{
  node: DocNode;
}>();

const Comp = computed<Component | null>(() => getWidgetRenderer(props.node.type));
</script>

