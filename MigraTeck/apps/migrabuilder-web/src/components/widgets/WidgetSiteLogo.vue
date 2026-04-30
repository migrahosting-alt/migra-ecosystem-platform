<template>
  <div class="migra-widget migra-widget--site-logo" :style="{ textAlign: align }">
    <img
      v-if="logoUrl"
      class="migra-site-logo"
      :src="logoUrl"
      alt="Site logo"
      :style="{ width: `${size}px`, height: 'auto' }"
    />
    <div v-else class="migra-unknown">
      <div class="text-sm font-semibold">Site Logo</div>
      <div class="text-xs migra-muted">Set a Custom Logo in the Inspector, or configure WordPress Custom Logo.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { DocNode } from '@/core/document';
import { siteBranding } from '@/core/siteBrandingStore';

const props = defineProps<{ node: DocNode }>();

const mode = computed(() => String((props.node.props as any)?.mode || 'wp'));
const customUrl = computed(() => String((props.node.props as any)?.image?.url || '').trim());
const align = computed(() => String((props.node.props as any)?.align || 'left') as 'left' | 'center' | 'right');
const size = computed(() => {
  const raw = Number((props.node.props as any)?.size);
  return Number.isFinite(raw) ? Math.max(16, Math.min(240, Math.round(raw))) : 48;
});

const logoUrl = computed(() => {
  if (mode.value === 'custom' && customUrl.value) return customUrl.value;
  if (siteBranding.value.customLogoUrl) return siteBranding.value.customLogoUrl;
  if (siteBranding.value.siteIconUrl) return siteBranding.value.siteIconUrl;
  return '';
});
</script>

