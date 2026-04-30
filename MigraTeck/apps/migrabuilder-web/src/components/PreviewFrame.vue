<template>
  <div class="h-full w-full overflow-hidden rounded-2xl border border-slate-800 bg-slate-950">
    <iframe
      ref="iframeEl"
      :src="previewUrl"
      class="h-full w-full"
      @load="handleLoaded"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

type EditorElement = {
  id: string;
  widgetType: string;
  settings?: Record<string, any>;
  elements?: EditorElement[];
};

const props = defineProps<{
  previewUrl: string;
  elements: EditorElement[];
}>();

const iframeEl = ref<HTMLIFrameElement | null>(null);
const isLoaded = ref(false);

const targetOrigin = computed(() => {
  const raw = String(props.previewUrl || '').trim();
  if (!raw) return '*';
  if (raw.startsWith('/')) return window.location.origin;
  try {
    return new URL(raw).origin;
  } catch {
    return '*';
  }
});

let debounceTimer: number | null = null;

function postUpdate() {
  if (!isLoaded.value) return;
  const win = iframeEl.value?.contentWindow;
  if (!win) return;
  win.postMessage(
    {
      type: 'migra-builder-update',
      elements: props.elements,
    },
    targetOrigin.value
  );
}

function handleLoaded() {
  isLoaded.value = true;
  postUpdate();
}

watch(
  () => props.elements,
  () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      postUpdate();
      debounceTimer = null;
    }, 150);
  },
  { deep: true }
);

onBeforeUnmount(() => {
  if (debounceTimer) window.clearTimeout(debounceTimer);
});
</script>
