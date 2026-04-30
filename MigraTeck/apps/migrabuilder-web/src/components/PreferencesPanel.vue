<template>
  <div class="p-4 space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <div class="text-xs uppercase tracking-[0.3em] migra-muted">Editor</div>
        <div class="text-sm font-semibold">Preferences</div>
      </div>
      <button
        class="migra-btn migra-btn--primary text-xs disabled:opacity-60"
        type="button"
        :disabled="saving"
        @click="save"
      >
        {{ saving ? 'Saving…' : 'Save' }}
      </button>
    </div>

    <div class="migra-card space-y-3">
      <label class="block">
        <span class="text-xs migra-muted">Scope</span>
        <select
          v-model="scope"
          class="migra-input mt-1 w-full text-sm"
        >
          <option value="user">My settings (per-user)</option>
          <option v-if="env.canEditGlobal" value="global">Global defaults (site-wide)</option>
        </select>
      </label>

      <div v-if="scope === 'global'" class="space-y-3">
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>Default: show shortcuts hint</span>
          <input
            type="checkbox"
            class="h-4 w-4 migra-checkbox"
            v-model="draftGlobal.showShortcutsHintDefault"
            :disabled="!env.canEditGlobal"
          />
        </label>

        <label class="flex items-center justify-between gap-3 text-sm">
          <span>Teleport wrap-around (first ↔ last root section)</span>
          <input
            type="checkbox"
            class="h-4 w-4 migra-checkbox"
            v-model="draftGlobal.teleportWrap"
            :disabled="!env.canEditGlobal"
          />
        </label>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
            :disabled="!env.canEditGlobal"
            @click="resetGlobalDefaults"
          >
            Reset global defaults
          </button>
        </div>

        <ThemeEditor
          v-model="draftGlobal.theme"
          :disabled="!env.canEditGlobal"
          :can-edit-global="env.canEditGlobal"
          @reset="resetThemeDefaults"
        />
      </div>

      <div v-else class="space-y-3">
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>Show shortcuts hint (my account)</span>
          <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="draftUser.showShortcutsHint" />
        </label>

        <label class="flex items-center justify-between gap-3 text-sm">
          <span>Use global keybindings (ignore my overrides)</span>
          <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="draftUser.useGlobalKeybindings" />
        </label>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            @click="$emit('show-hint')"
          >
            Show hint again (this device)
          </button>
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            @click="$emit('dismiss-hint')"
          >
            Dismiss hint (this device)
          </button>
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            @click="resetMyOverrides"
          >
            Reset my overrides
          </button>
        </div>
      </div>
    </div>

    <KeybindingsEditor
      v-if="scope === 'global'"
      v-model="draftGlobal.keybindings"
      :read-only="!env.canEditGlobal"
    />

    <KeybindingsEditor
      v-else
      v-model="editingKeybindings"
      :read-only="draftUser.useGlobalKeybindings"
    />

    <div v-if="status" class="text-xs migra-muted">{{ status }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import KeybindingsEditor from './KeybindingsEditor.vue';
import ThemeEditor from './ThemeEditor.vue';
import type { Keybindings, SettingsEnvelope, GlobalSettings, ThemeTokens, UserSettings } from '@/core/settings';
import {
  DEFAULT_KEYBINDINGS,
  DEFAULT_SETTINGS_ENVELOPE,
  diffOverrides,
  mergeEffectiveKeybindings,
  saveSettingsEnvelope,
} from '@/core/settings';

const props = defineProps<{
  env: SettingsEnvelope;
}>();

const emit = defineEmits<{
  (e: 'update', env: SettingsEnvelope): void;
  (e: 'show-hint'): void;
  (e: 'dismiss-hint'): void;
  (e: 'preview-theme', theme: ThemeTokens | null): void;
}>();

const scope = ref<'user' | 'global'>(props.env.canEditGlobal ? 'user' : 'user');
const saving = ref(false);
const status = ref('');

const draftGlobal = ref<GlobalSettings>(structuredClone(props.env.global));
const draftUser = ref<UserSettings>(structuredClone(props.env.user));

watch(
  () => props.env,
  (next) => {
    draftGlobal.value = structuredClone(next.global);
    draftUser.value = structuredClone(next.user);
  },
  { deep: true }
);

watch(
  [scope, () => draftGlobal.value.theme],
  () => {
    if (scope.value !== 'global') return;
    emit('preview-theme', structuredClone(draftGlobal.value.theme));
  },
  { deep: true }
);

watch(scope, (next) => {
  if (next !== 'global') emit('preview-theme', null);
});

const editingKeybindings = computed<Keybindings>({
  get() {
    const g = { ...DEFAULT_KEYBINDINGS, ...(draftGlobal.value.keybindings || {}) } as Keybindings;
    return mergeEffectiveKeybindings(g, draftUser.value);
  },
  set(next) {
    const g = { ...DEFAULT_KEYBINDINGS, ...(draftGlobal.value.keybindings || {}) } as Keybindings;
    draftUser.value = {
      ...draftUser.value,
      keybindingsOverride: diffOverrides(g, next),
    };
  },
});

function resetMyOverrides() {
  draftUser.value = {
    ...draftUser.value,
    useGlobalKeybindings: false,
    keybindingsOverride: {},
  };
  status.value = 'Cleared your overrides (not saved yet)';
  window.setTimeout(() => (status.value = ''), 1800);
}

function resetGlobalDefaults() {
  draftGlobal.value = structuredClone(DEFAULT_SETTINGS_ENVELOPE.global);
  status.value = 'Reset global defaults (not saved yet)';
  window.setTimeout(() => (status.value = ''), 1800);
}

function resetThemeDefaults() {
  draftGlobal.value = {
    ...draftGlobal.value,
    theme: structuredClone(DEFAULT_SETTINGS_ENVELOPE.global.theme),
  };
  status.value = 'Reset theme defaults (not saved yet)';
  window.setTimeout(() => (status.value = ''), 1800);
}

async function save() {
  status.value = '';
  saving.value = true;
  try {
    const res =
      scope.value === 'global'
        ? await saveSettingsEnvelope({ scope: 'global', settings: draftGlobal.value as Record<string, unknown> })
        : await saveSettingsEnvelope({ scope: 'user', settings: draftUser.value as Record<string, unknown> });
    emit('update', res);
    emit('preview-theme', null);
    status.value = 'Saved';
  } catch (e: any) {
    status.value = e?.message ? `Save failed: ${e.message}` : 'Save failed';
  } finally {
    saving.value = false;
    setTimeout(() => (status.value = ''), 1800);
  }
}
</script>
