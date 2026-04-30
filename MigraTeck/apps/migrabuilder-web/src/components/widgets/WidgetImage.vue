<template>
  <figure class="migra-widget migra-widget--image" :style="{ textAlign: align }">
    <img v-if="url" :src="url" alt="" class="migra-widget__img" />
    <div v-else class="migra-unknown">
      <div class="text-sm font-semibold">Image</div>
      <div class="text-xs migra-muted">Set `image.url` in the Inspector.</div>
    </div>
    <figcaption v-if="caption" class="text-xs migra-muted mt-2">{{ caption }}</figcaption>
  </figure>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';

const props = defineProps<{ node: DocNode }>();

const url = computed(() => String((props.node.props as any)?.image?.url || '').trim());
const caption = computed(() => String((props.node.props as any)?.caption || '').trim());
const align = computed(() => String((props.node.props as any)?.align || 'center') as 'left' | 'center' | 'right');
</script>

