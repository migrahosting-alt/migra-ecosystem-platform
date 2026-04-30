<template>
  <div class="migra-widget migra-widget--spacer" :style="{ height: `${height}px` }" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();
const height = computed(() => Number((props.node.props as any)?.height ?? 40));
</script>

