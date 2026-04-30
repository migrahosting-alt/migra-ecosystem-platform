<template>
  <div class="space-y-4 p-4">
    <div v-if="!element" class="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-6 text-sm text-slate-400">
      Select an element from Navigator to edit its settings.
    </div>

    <section v-else class="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
      <h3 class="text-xs uppercase tracking-[0.4em] text-slate-500">Selected</h3>
      <div class="mt-3">
        <p class="text-base font-semibold text-white">{{ element.widgetType }}</p>
        <p class="text-xs text-slate-500">{{ element.id }}</p>
      </div>
    </section>

    <section v-if="element" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 class="text-xs uppercase tracking-[0.4em] text-slate-500">Content</h3>
      <div class="mt-3 space-y-3 text-sm text-slate-300">
        <template v-if="element.widgetType === 'heading'">
          <label class="flex flex-col gap-1">
            <span>Title</span>
            <input
              v-model="draft.title"
              type="text"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Add a title"
              @input="emitUpdate"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span>Tag</span>
              <select
                v-model="draft.tag"
                class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                @change="emitUpdate"
              >
                <option value="h1">H1</option>
                <option value="h2">H2</option>
                <option value="h3">H3</option>
                <option value="h4">H4</option>
                <option value="h5">H5</option>
                <option value="h6">H6</option>
                <option value="div">Div</option>
                <option value="p">P</option>
                <option value="span">Span</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span>Align</span>
              <select
                v-model="draft.align"
                class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                @change="emitUpdate"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
        </template>

        <template v-else-if="element.widgetType === 'text-editor'">
          <label class="flex flex-col gap-1">
            <span>Text</span>
            <textarea
              v-model="draft.editor"
              rows="5"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Write something…"
              @input="emitUpdate"
            ></textarea>
          </label>
          <label class="flex flex-col gap-1">
            <span>Align</span>
            <select
              v-model="draft.align"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              @change="emitUpdate"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </template>

        <template v-else-if="element.widgetType === 'button'">
          <label class="flex flex-col gap-1">
            <span>Text</span>
            <input
              v-model="draft.text"
              type="text"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Button label"
              @input="emitUpdate"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span>Link</span>
            <input
              v-model="draft.link"
              type="text"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="https://… or #"
              @input="emitUpdate"
            />
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="flex flex-col gap-1">
              <span>Type</span>
              <select
                v-model="draft.type"
                class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                @change="emitUpdate"
              >
                <option value="primary">Primary</option>
                <option value="secondary">Secondary</option>
                <option value="link">Link</option>
              </select>
            </label>
            <label class="flex flex-col gap-1">
              <span>Align</span>
              <select
                v-model="draft.align"
                class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
                @change="emitUpdate"
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>
          </div>
        </template>

        <template v-else-if="element.widgetType === 'image'">
          <label class="flex flex-col gap-1">
            <span>Image URL</span>
            <input
              v-model="draft.imageUrl"
              type="text"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="https://…"
              @input="emitUpdate"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span>Caption</span>
            <input
              v-model="draft.caption"
              type="text"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Optional caption"
              @input="emitUpdate"
            />
          </label>
          <label class="flex flex-col gap-1">
            <span>Align</span>
            <select
              v-model="draft.align"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
              @change="emitUpdate"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </label>
        </template>

        <template v-else>
          <div class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-3 text-sm text-slate-400">
            This widget does not have a settings UI yet. Advanced settings below still apply.
          </div>
        </template>
      </div>
    </section>

    <section v-if="element" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 class="text-xs uppercase tracking-[0.4em] text-slate-500">Style</h3>
      <div class="mt-3 grid gap-3 text-sm text-slate-300">
        <label class="flex items-center gap-3">
          <input
            v-model="draft.textColor"
            type="color"
            class="h-10 w-10 rounded-full border border-slate-700 bg-transparent"
            @input="emitUpdate"
          />
          <span>Text Color</span>
        </label>
        <div>
          <span class="text-xs text-slate-500">Padding</span>
          <div class="mt-2 grid grid-cols-2 gap-2">
            <input
              v-model.number="draft.paddingTop"
              type="number"
              min="0"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs focus:border-primary focus:outline-none"
              placeholder="Top"
              @input="emitUpdate"
            />
            <input
              v-model.number="draft.paddingBottom"
              type="number"
              min="0"
              class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs focus:border-primary focus:outline-none"
              placeholder="Bottom"
              @input="emitUpdate"
            />
          </div>
        </div>
      </div>
    </section>

    <section v-if="element" class="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
      <h3 class="text-xs uppercase tracking-[0.4em] text-slate-500">Advanced</h3>
      <div class="mt-3 text-sm text-slate-300 space-y-3">
        <label class="flex flex-col gap-1">
          <span>CSS ID</span>
          <input
            v-model="draft.cssId"
            type="text"
            class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            placeholder="Optional ID"
            @input="emitUpdate"
          />
        </label>
        <label class="flex flex-col gap-1">
          <span>CSS Classes</span>
          <input
            v-model="draft.cssClasses"
            type="text"
            class="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm focus:border-primary focus:outline-none"
            placeholder="class-one class-two"
            @input="emitUpdate"
          />
        </label>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue';

export type EditorElement = {
  id: string;
  widgetType: string;
  settings?: Record<string, any>;
};

const props = defineProps<{
  element: EditorElement | null;
}>();

const emit = defineEmits<{
  (e: 'update', payload: { id: string; settings: Record<string, any> }): void;
}>();

const initialSettings = computed(() => props.element?.settings || {});

const draft = reactive({
  title: '',
  tag: 'h2',
  align: 'left',
  editor: '',
  text: '',
  link: '',
  type: 'primary',
  imageUrl: '',
  caption: '',
  textColor: '#0f172a',
  paddingTop: 0,
  paddingBottom: 0,
  cssId: '',
  cssClasses: '',
});

function hydrateFromElement() {
  const s = initialSettings.value || {};

  draft.title = String(s.title || '');
  draft.tag = String(s.tag || 'h2');
  draft.align = String(s.align || 'left');
  draft.editor = String(s.editor || '');
  draft.text = String(s.text || '');
  draft.link = String(s.link || '');
  draft.type = String(s.type || 'primary');
  draft.imageUrl = String((s.image && s.image.url) || '');
  draft.caption = String(s.caption || '');

  draft.textColor = String(s.color || '#0f172a');
  draft.paddingTop = Number.isFinite(Number(s.padding_top)) ? Number(s.padding_top) : 0;
  draft.paddingBottom = Number.isFinite(Number(s.padding_bottom)) ? Number(s.padding_bottom) : 0;
  draft.cssId = String(s.css_id || '');
  draft.cssClasses = String(s.css_classes || '');
}

watch(
  () => props.element?.id,
  () => hydrateFromElement(),
  { immediate: true }
);

function emitUpdate() {
  if (!props.element) return;

  const next: Record<string, any> = { ...(props.element.settings || {}) };

  // Widget-specific content
  if (props.element.widgetType === 'heading') {
    next.title = draft.title;
    next.tag = draft.tag;
    next.align = draft.align;
    next.color = draft.textColor;
  } else if (props.element.widgetType === 'text-editor') {
    next.editor = draft.editor;
    next.align = draft.align;
  } else if (props.element.widgetType === 'button') {
    next.text = draft.text;
    next.link = draft.link;
    next.type = draft.type;
    next.align = draft.align;
  } else if (props.element.widgetType === 'image') {
    next.image = { ...(next.image || {}), url: draft.imageUrl, id: 0 };
    next.caption = draft.caption;
    next.align = draft.align;
  }

  // Generic style/advanced
  next.color = draft.textColor;
  next.padding_top = draft.paddingTop;
  next.padding_bottom = draft.paddingBottom;
  next.css_id = draft.cssId;
  next.css_classes = draft.cssClasses;

  emit('update', { id: props.element.id, settings: next });
}
</script>
