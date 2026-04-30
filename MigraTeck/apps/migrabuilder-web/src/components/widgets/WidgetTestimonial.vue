<template>
  <div class="migra-widget migra-widget--testimonial">
    <div class="migra-testimonial-quote">
      “{{ content || 'Testimonial content…' }}”
    </div>
    <div class="migra-row mt-3" style="justify-content: space-between;">
      <div>
        <div class="text-sm font-semibold">{{ name || 'Jane Doe' }}</div>
        <div class="text-xs migra-muted">{{ title || 'Title' }}</div>
      </div>
      <div class="migra-testimonial-dot" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const content = computed(() => String((props.node.props as any)?.content || '').trim());
const name = computed(() => String((props.node.props as any)?.name || '').trim());
const title = computed(() => String((props.node.props as any)?.title || '').trim());
</script>

