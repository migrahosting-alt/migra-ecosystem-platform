<template>
  <div class="migra-inlinebar" @click.stop>
    <button
      type="button"
      class="migra-inlinebar__btn"
      title="Move up (Alt+↑)"
      :disabled="!canMoveUp"
      @click="$emit('move-relative', -1)"
    >
      ↑
    </button>
    <button
      type="button"
      class="migra-inlinebar__btn"
      title="Move down (Alt+↓)"
      :disabled="!canMoveDown"
      @click="$emit('move-relative', 1)"
    >
      ↓
    </button>
    <span class="migra-inlinebar__sep" />
    <button
      type="button"
      class="migra-inlinebar__btn"
      title="Indent (Tab)"
      :disabled="!canIndent"
      @click="$emit('indent')"
    >
      ⇥
    </button>
    <button
      type="button"
      class="migra-inlinebar__btn"
      title="Outdent (Shift+Tab)"
      :disabled="!canOutdent"
      @click="$emit('outdent')"
    >
      ⇤
    </button>
    <span class="migra-inlinebar__sep" />
    <button
      type="button"
      class="migra-inlinebar__btn"
      :title="lockAll ? 'Unlock selection' : 'Lock selection'"
      :disabled="!canToggleLockHide"
      @click="$emit('toggle-lock')"
    >
      {{ lockAll ? '🔓' : '🔒' }}
    </button>
    <button
      type="button"
      class="migra-inlinebar__btn"
      :title="hideAll ? 'Unhide selection' : 'Hide selection'"
      :disabled="!canToggleLockHide"
      @click="$emit('toggle-hidden')"
    >
      {{ hideAll ? '👁' : '🙈' }}
    </button>
    <span class="migra-inlinebar__sep" />
    <button
      type="button"
      class="migra-inlinebar__btn"
      title="Duplicate (Ctrl/Cmd+D)"
      :disabled="disabled"
      @click="$emit('duplicate')"
    >
      ⧉
    </button>
    <button
      type="button"
      class="migra-inlinebar__btn migra-inlinebar__btn--danger"
      title="Delete (Del)"
      :disabled="disabled"
      @click="$emit('delete')"
    >
      ⌫
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  disabled?: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canIndent: boolean;
  canOutdent: boolean;
  canToggleLockHide: boolean;
  lockAll: boolean;
  hideAll: boolean;
}>();

defineEmits<{
  (e: 'move-relative', delta: -1 | 1): void;
  (e: 'indent'): void;
  (e: 'outdent'): void;
  (e: 'toggle-lock'): void;
  (e: 'toggle-hidden'): void;
  (e: 'duplicate'): void;
  (e: 'delete'): void;
}>();
</script>
