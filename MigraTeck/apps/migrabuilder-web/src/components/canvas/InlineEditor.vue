<template>
  <div class="migra-inline-editor" @click.stop>
    <template v-if="kind === 'input'">
      <input
        ref="inputRef"
        class="migra-input w-full text-sm"
        :value="draft"
        @input="draft = ($event.target as HTMLInputElement).value"
        @keydown="onKeydown"
        @blur="commit"
      />
      <div class="migra-inline-editor__hint text-xs migra-muted">Enter to save • Esc to cancel</div>
    </template>

    <template v-else>
      <textarea
        ref="textareaRef"
        class="migra-input w-full text-sm"
        rows="5"
        :value="draft"
        @input="draft = ($event.target as HTMLTextAreaElement).value"
        @keydown="onKeydown"
        @blur="commit"
      />
      <div class="migra-inline-editor__hint text-xs migra-muted">Ctrl/Cmd+Enter to save • Esc to cancel</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import type { InlineEditKind } from '@/core/inlineEdit';

const props = defineProps<{
  kind: InlineEditKind;
  initialValue: string;
}>();

const emit = defineEmits<{
  (e: 'commit', value: string): void;
  (e: 'cancel'): void;
}>();

const draft = ref(props.initialValue);
const inputRef = ref<HTMLInputElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

onMounted(async () => {
  await nextTick();
  if (props.kind === 'input') inputRef.value?.focus();
  else textareaRef.value?.focus();
});

function commit() {
  emit('commit', draft.value);
}

function cancel() {
  emit('cancel');
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    cancel();
    return;
  }

  if (props.kind === 'input' && e.key === 'Enter') {
    e.preventDefault();
    commit();
    return;
  }

  if (props.kind === 'textarea' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    commit();
  }
}
</script>

