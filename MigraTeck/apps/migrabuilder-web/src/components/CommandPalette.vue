<template>
  <teleport to="body">
    <div v-if="open" class="migra-palette-overlay" @click.self="close">
      <div class="migra-palette" role="dialog" aria-label="Command palette">
        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="text-xs uppercase tracking-[0.3em] migra-muted">Command</div>
            <div class="text-sm font-semibold">Palette</div>
          </div>
          <button type="button" class="migra-btn migra-btn--ghost text-xs" @click="close">Esc</button>
        </div>

        <input
          ref="inputRef"
          v-model="query"
          class="migra-input w-full mt-3"
          type="text"
          placeholder="Search… (↑↓, Enter)"
          @keydown="onKeyDown"
        />

        <div class="migra-palette-list mt-3">
          <div v-if="filtered.length === 0" class="p-3 text-xs migra-muted">No matches.</div>
          <button
            v-for="(item, idx) in filtered.slice(0, 50)"
            :key="item.id"
            type="button"
            class="migra-palette-item"
            :class="idx === activeIndex ? 'migra-palette-item--active' : ''"
            @click="run(item)"
          >
            <div class="font-semibold">{{ item.title }}</div>
            <div v-if="item.subtitle" class="text-xs migra-muted">{{ item.subtitle }}</div>
          </button>
        </div>

        <div class="flex justify-end mt-3">
          <button type="button" class="migra-btn migra-btn--ghost text-xs" @click="close">Close</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

export type PaletteItem = {
  id: string;
  title: string;
  subtitle?: string;
  run: () => void | Promise<void>;
};

const props = defineProps<{
  open: boolean;
  items: PaletteItem[];
}>();

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const query = ref('');
const activeIndex = ref(0);
const inputRef = ref<HTMLInputElement | null>(null);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.items;
  return props.items.filter((it) => `${it.title} ${it.subtitle || ''}`.toLowerCase().includes(q));
});

watch(
  () => props.open,
  async (next) => {
    if (!next) return;
    query.value = '';
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus?.();
  },
);

function close() {
  emit('close');
}

async function run(item: PaletteItem) {
  await item.run();
  close();
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    close();
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(activeIndex.value + 1, Math.max(0, filtered.value.length - 1));
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(activeIndex.value - 1, 0);
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const item = filtered.value[activeIndex.value];
    if (item) void run(item);
  }
}
</script>

