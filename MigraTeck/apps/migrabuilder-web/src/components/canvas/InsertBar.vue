<template>
  <div
    class="migra-insertbar"
    :class="active ? 'migra-insertbar--active' : ''"
    :data-mg-insert-parent-id="parentId"
    :data-mg-insert-index="String(index)"
  >
    <button
      ref="anchor"
      type="button"
      class="migra-insertbar__btn"
      :disabled="disabled"
      @click.stop="toggle"
      :title="label || 'Insert'"
    >
      <span class="migra-insertbar__plus">+</span>
      <span class="migra-insertbar__text">{{ label || 'Add' }}</span>
    </button>

    <div v-if="open" ref="pop" class="migra-insertbar__pop" @click.stop>
      <div class="migra-insertbar__pophead">
        <input
          v-model="q"
          class="migra-input w-full text-sm"
          placeholder="Search & insert…"
        />
      </div>

      <div class="migra-insertbar__popbody">
        <div v-if="quick.length" class="migra-insertbar__section">
          <div class="migra-insertbar__title">Quick</div>
          <div class="migra-insertbar__grid">
            <button
              v-for="w in quick"
              :key="w.name"
              type="button"
              class="migra-insertbar__chip"
              @click="add(w.name)"
            >
              {{ w.title || w.name }}
            </button>
          </div>
        </div>

        <div
          v-for="[cat, items] in grouped"
          :key="cat"
          class="migra-insertbar__section"
        >
          <div class="migra-insertbar__title">{{ cat }}</div>
          <div class="migra-insertbar__list">
            <button
              v-for="w in items"
              :key="w.name"
              type="button"
              class="migra-insertbar__item"
              @click="add(w.name)"
            >
              <span class="font-semibold">{{ w.title || w.name }}</span>
              <span class="text-xs migra-muted">{{ w.name }}</span>
            </button>
          </div>
        </div>

        <div v-if="!filtered.length" class="text-xs migra-muted">
          No widgets found.
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { BUILDER_DND_KEY } from './useBuilderDnd';

export type InsertWidget = {
  name: string;
  title: string;
  category?: string;
};

const props = defineProps<{
  parentId: string;
  index: number;
  widgets: InsertWidget[];
  label?: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'insert', widgetType: string): void;
}>();

const open = ref(false);
const q = ref('');
const anchor = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);

const dnd = inject(BUILDER_DND_KEY, null);
const active = computed(() => {
  const s = dnd?.state;
  if (!s?.dragging) return false;
  if (s.overNodeId || s.overListParentId) return false;
  return s.toParentId === props.parentId && s.toIndex === props.index;
});

const normalizedQuery = computed(() => q.value.trim().toLowerCase());

const filtered = computed(() => {
  const base = props.widgets || [];
  if (!normalizedQuery.value) return base;
  return base.filter((w) => {
    const hay = `${w.title || ''} ${w.name || ''} ${w.category || ''}`.toLowerCase();
    return hay.includes(normalizedQuery.value);
  });
});

const quick = computed(() => {
  const preferred = ['section', 'container', 'heading', 'text-editor', 'image', 'button', 'divider', 'spacer'];
  const map = new Map(filtered.value.map((w) => [w.name, w]));
  return preferred.map((t) => map.get(t)).filter(Boolean) as InsertWidget[];
});

const grouped = computed(() => {
  const map = new Map<string, InsertWidget[]>();
  for (const w of filtered.value) {
    const c = w.category || 'general';
    if (!map.has(c)) map.set(c, []);
    map.get(c)!.push(w);
  }
  return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
});

function close() {
  open.value = false;
  q.value = '';
}

function toggle() {
  if (props.disabled) return;
  open.value = !open.value;
  if (open.value) {
    nextTick(() => {
      pop.value?.querySelector<HTMLInputElement>('input')?.focus();
    });
  }
}

function add(type: string) {
  emit('insert', type);
  close();
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (pop.value?.contains(t)) return;
  if (anchor.value?.contains(t)) return;
  close();
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));

watch(
  () => props.disabled,
  (next) => {
    if (next) close();
  }
);
</script>
