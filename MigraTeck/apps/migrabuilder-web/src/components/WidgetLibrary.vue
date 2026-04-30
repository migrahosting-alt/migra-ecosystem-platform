<template>
  <div class="p-4 space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-xs uppercase tracking-[0.4em] migra-muted">Widgets</h3>
      <span class="text-xs migra-muted">{{ filteredCount }} items</span>
    </div>

    <label class="block">
      <span class="sr-only">Search widgets</span>
      <input
        v-model="query"
        type="text"
        placeholder="Search widgets…"
        class="migra-input w-full text-sm"
      />
    </label>

    <div class="space-y-3">
      <section
        v-for="categoryKey in orderedCategoryKeys"
        :key="categoryKey"
        class="migra-card"
      >
        <button
          type="button"
          class="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
          @click="toggleCategory(categoryKey)"
        >
          <div class="flex items-center gap-3">
            <span class="migra-iconchip h-8 w-8 rounded-xl flex items-center justify-center text-xs migra-muted">
              {{ categoryLabel(categoryKey).charAt(0) }}
            </span>
            <div>
              <p class="text-sm font-semibold">{{ categoryLabel(categoryKey) }}</p>
              <p class="text-xs migra-muted">{{ widgetsForCategory(categoryKey).length }} widgets</p>
            </div>
          </div>
          <span class="migra-muted text-xs">
            {{ openCategories.has(categoryKey) ? '−' : '+' }}
          </span>
        </button>

        <div v-if="openCategories.has(categoryKey)" class="migra-divider px-4 py-3 space-y-2">
          <button
            v-for="widget in widgetsForCategory(categoryKey)"
            :key="widget.name"
            type="button"
            class="migra-widgetitem flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition"
            @click="$emit('add', widget)"
          >
            <div class="flex items-center gap-3">
              <span class="migra-iconchip h-8 w-8 rounded-xl flex items-center justify-center text-xs migra-muted">
                {{ (widgetLabel(widget).title || widget.name || 'W').charAt(0) }}
              </span>
              <div>
                <p class="font-semibold">{{ widgetLabel(widget).title || widget.name }}</p>
                <p v-if="widgetLabel(widget).subtitle" class="text-xs migra-muted">{{ widgetLabel(widget).subtitle }}</p>
              </div>
            </div>
            <span class="migra-btn migra-btn--primary text-xs">Add</span>
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { displayTitleAndSubtitle } from '@/core/labels';

export type WidgetDefinition = {
  name: string;
  title: string;
  category?: string;
};

export type CategoryDefinition = {
  title?: string;
  icon?: string;
};

const props = defineProps<{
  widgets: WidgetDefinition[];
  categories: Record<string, CategoryDefinition>;
}>();

defineEmits<{
  (e: 'add', widget: WidgetDefinition): void;
}>();

const query = ref('');
const openCategories = ref(new Set<string>(['basic', 'general']));

const normalizedQuery = computed(() => query.value.trim().toLowerCase());

const filteredWidgets = computed(() => {
  if (!normalizedQuery.value) return props.widgets;
  return props.widgets.filter((widget) => {
    const title = String(widget.title || '').toLowerCase();
    const name = String(widget.name || '').toLowerCase();
    return title.includes(normalizedQuery.value) || name.includes(normalizedQuery.value);
  });
});

const orderedCategoryKeys = computed(() => {
  const keys = Object.keys(props.categories || {});
  if (!keys.length) {
    return Array.from(new Set(filteredWidgets.value.map((w) => w.category || 'general')));
  }
  return keys;
});

const filteredCount = computed(() => filteredWidgets.value.length);

function categoryLabel(key: string): string {
  return props.categories?.[key]?.title || key;
}

function widgetsForCategory(categoryKey: string): WidgetDefinition[] {
  return filteredWidgets.value.filter((w) => (w.category || 'general') === categoryKey);
}

function widgetLabel(widget: WidgetDefinition) {
  return displayTitleAndSubtitle(widget.title, widget.name);
}

function toggleCategory(key: string) {
  const next = new Set(openCategories.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  openCategories.value = next;
}
</script>
