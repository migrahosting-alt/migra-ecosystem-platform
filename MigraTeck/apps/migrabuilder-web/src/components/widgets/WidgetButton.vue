<template>
  <div class="migra-widget migra-widget--button" :style="{ textAlign: align }">
    <a
      class="migra-btn migra-btn--primary text-xs inline-flex items-center gap-2"
      :href="href"
      @click.prevent
    >
      {{ label }}
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const label = computed(() => String((props.node.props as any)?.text || 'Button'));
const href = computed(() => String((props.node.props as any)?.link || '#'));
const align = computed(() => String((props.node.props as any)?.align || 'left') as 'left' | 'center' | 'right');
</script>

