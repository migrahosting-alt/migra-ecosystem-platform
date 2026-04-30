<template>
  <section class="migra-card">
    <header class="migra-card__header">
      <div class="migra-card__heading">
        <div class="migra-card__eyebrow">Branding</div>
        <div class="migra-card__title">Theme tokens</div>
        <div class="migra-card__subtitle">Updates preview live while you edit global defaults.</div>
      </div>
      <div class="migra-row">
        <button type="button" class="migra-btn migra-btn--ghost text-xs" :disabled="disabled" @click="$emit('reset')">
          Reset theme
        </button>
      </div>
    </header>

    <div class="migra-card__body migra-stack migra-stack--lg">
      <div v-if="failedRows.length" class="migra-theme-warn">
        <div class="text-sm font-semibold">Contrast warning</div>
        <div class="text-xs migra-muted">
          Some combinations may be hard to read. Aim for AA (≥ 4.5:1) for normal text.
        </div>
        <div class="mt-2 text-xs migra-muted">
          Failing: {{ failedRows.map((r) => r.label).join(', ') }}
        </div>
      </div>

      <div class="migra-theme-presets migra-stack migra-stack--sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="migra-h2">Presets</div>
            <div class="text-xs migra-muted">Save, apply, share, and import theme token sets.</div>
          </div>
          <div class="migra-row">
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :disabled="loadingPresets"
              @click="reloadPresets"
            >
              {{ loadingPresets ? 'Loading…' : 'Refresh' }}
            </button>
            <button
              type="button"
              class="migra-btn migra-btn--primary text-xs"
              :disabled="disabled || loadingPresets || !restReady"
              @click="saveCurrentAsPreset"
            >
              Save current
            </button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :disabled="disabled || loadingPresets || !restReady"
              @click="importPresetJson"
            >
              Import JSON
            </button>
          </div>
        </div>

        <div class="migra-row">
          <label class="block">
            <span class="migra-field__label">Import by ID</span>
            <input
              type="text"
              class="migra-input text-sm"
              style="width: 280px;"
              placeholder="paste 32-char share id"
              :disabled="disabled || loadingPresets || !restReady"
              v-model="importId"
            />
          </label>
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            :disabled="disabled || loadingPresets || !restReady || !importId.trim()"
            @click="importById"
          >
            Import
          </button>
          <div class="flex-1"></div>
        </div>

        <div class="migra-row">
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            :class="presetScope === 'user' ? 'migra-btn--active' : ''"
            @click="presetScope = 'user'"
          >
            My Presets ({{ presetsUser.length }})
          </button>
          <button
            v-if="canEditGlobal"
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            :class="presetScope === 'global' ? 'migra-btn--active' : ''"
            @click="presetScope = 'global'"
          >
            Global Presets ({{ presetsGlobal.length }})
          </button>
          <div v-if="presetMsg" class="text-xs" :class="presetMsg.type === 'error' ? 'text-red-300' : 'migra-muted'">
            {{ presetMsg.text }}
          </div>
        </div>

        <div v-if="activePresets.length" class="migra-preset-grid">
          <div v-for="p in activePresets" :key="p.id" class="migra-preset-card">
            <button
              type="button"
              class="migra-preset-card__swirl"
              :disabled="disabled"
              @click="applyPreset(p)"
              :title="disabled ? 'You do not have permission to edit global theme.' : 'Apply preset'"
            >
              <div
                class="migra-preset-card__swatch"
                :style="{
                  background: `radial-gradient(120px 80px at 10% 10%, ${p.theme.accent}55, transparent 65%),
                               radial-gradient(120px 80px at 90% 30%, ${p.theme.accent2}55, transparent 65%),
                               ${p.theme.panel}` }
                "
              />
              <div class="migra-preset-card__meta">
                <div class="text-sm font-semibold truncate">
                  <span v-if="p.pinned" title="Pinned">📌 </span>{{ p.name }}
                </div>
                <div class="text-xs migra-muted truncate">{{ p.id }}</div>
              </div>
            </button>

            <div class="migra-row" style="justify-content: space-between;">
              <button type="button" class="migra-btn migra-btn--ghost text-xs" :disabled="disabled || !restReady" @click="togglePin(p)">
                {{ p.pinned ? 'Unpin' : 'Pin' }}
              </button>
              <button type="button" class="migra-btn migra-btn--ghost text-xs" :disabled="disabled || !restReady" @click="renamePreset(p)">
                Rename
              </button>
              <button type="button" class="migra-btn migra-btn--ghost text-xs" :disabled="!restReady" @click="shareLink(p)">
                Share link
              </button>
              <button type="button" class="migra-btn migra-btn--ghost text-xs" @click="copyPresetJson(p)">
                Copy JSON
              </button>
              <button type="button" class="migra-btn migra-btn--ghost text-xs" :disabled="disabled || !restReady" @click="deletePresetUi(p)">
                Delete
              </button>
            </div>
          </div>
        </div>

        <div v-else class="text-xs migra-muted">
          No presets yet. Save the current theme as a preset to reuse it later.
        </div>
      </div>

      <div class="migra-card migra-stack migra-stack--sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="migra-h2">Auto-Tune Tokens</div>
            <div class="text-xs migra-muted">Derives surfaces + text from Background so contrast stays readable.</div>
          </div>
          <div class="migra-row">
            <button
              type="button"
              class="migra-btn migra-btn--primary text-xs"
              :disabled="disabled || !autoCfg.enabled"
              @click="applyAutoTuneNow"
            >
              Apply now
            </button>
          </div>
        </div>

        <label class="flex items-center justify-between gap-3 text-sm">
          <span>Enable Auto-Tune</span>
          <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="autoCfg.enabled" :disabled="disabled" />
        </label>

        <div class="grid grid-cols-2 gap-3">
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>Tune text + muted</span>
            <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="autoCfg.tuneText" :disabled="disabled || !autoCfg.enabled" />
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>Tune panel surfaces</span>
            <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="autoCfg.tuneSurfaces" :disabled="disabled || !autoCfg.enabled" />
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>Tune border + shadow</span>
            <input type="checkbox" class="h-4 w-4 migra-checkbox" v-model="autoCfg.tuneBorderShadow" :disabled="disabled || !autoCfg.enabled" />
          </label>
        </div>

        <label class="migra-field">
          <span class="migra-field__label">Surface lift (Panel): {{ Math.round(autoCfg.surface * 100) }}%</span>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="3"
              max="14"
              step="1"
              class="flex-1"
              :disabled="disabled || !autoCfg.enabled"
              :value="String(Math.round(autoCfg.surface * 100))"
              @input="autoCfg.surface = (Number(($event.target as HTMLInputElement).value) / 100)"
            />
          </div>
          <div class="text-xs migra-muted">Higher = panel separates more from background.</div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Surface lift (Panel alt): {{ Math.round(autoCfg.surface2 * 100) }}%</span>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="5"
              max="22"
              step="1"
              class="flex-1"
              :disabled="disabled || !autoCfg.enabled"
              :value="String(Math.round(autoCfg.surface2 * 100))"
              @input="autoCfg.surface2 = (Number(($event.target as HTMLInputElement).value) / 100)"
            />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Muted strength: {{ Math.round(autoCfg.mutedBlend * 100) }}%</span>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="35"
              max="75"
              step="1"
              class="flex-1"
              :disabled="disabled || !autoCfg.enabled"
              :value="String(Math.round(autoCfg.mutedBlend * 100))"
              @input="autoCfg.mutedBlend = (Number(($event.target as HTMLInputElement).value) / 100)"
            />
          </div>
          <div class="text-xs migra-muted">Higher = muted text blends more into background.</div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Border alpha: {{ Math.round(autoCfg.borderAlpha * 100) }}%</span>
          <div class="flex items-center gap-3">
            <input
              type="range"
              min="8"
              max="22"
              step="1"
              class="flex-1"
              :disabled="disabled || !autoCfg.enabled"
              :value="String(Math.round(autoCfg.borderAlpha * 100))"
              @input="autoCfg.borderAlpha = (Number(($event.target as HTMLInputElement).value) / 100)"
            />
          </div>
        </label>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="migra-field">
          <span class="migra-field__label">Accent</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.accent" :disabled="disabled" @input="set('accent', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.accent" :disabled="disabled" @input="set('accent', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Accent 2</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.accent2" :disabled="disabled" @input="set('accent2', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.accent2" :disabled="disabled" @input="set('accent2', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Background</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.bg" :disabled="disabled" @input="set('bg', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.bg" :disabled="disabled" @input="set('bg', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Panel</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.panel" :disabled="disabled" @input="set('panel', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.panel" :disabled="disabled" @input="set('panel', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Panel 2</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.panel2" :disabled="disabled" @input="set('panel2', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.panel2" :disabled="disabled" @input="set('panel2', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Text</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.text" :disabled="disabled" @input="set('text', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.text" :disabled="disabled" @input="set('text', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>

        <label class="migra-field">
          <span class="migra-field__label">Muted</span>
          <div class="migra-color">
            <input type="color" class="migra-color__swatch" :value="modelValue.muted" :disabled="disabled" @input="set('muted', ($event.target as HTMLInputElement).value)" />
            <input type="text" class="migra-input flex-1" :value="modelValue.muted" :disabled="disabled" @input="set('muted', ($event.target as HTMLInputElement).value)" />
          </div>
        </label>
      </div>

      <label class="migra-field">
        <span class="migra-field__label">Border (rgba)</span>
        <input type="text" class="migra-input w-full" :value="modelValue.border" :disabled="disabled" @input="set('border', ($event.target as HTMLInputElement).value)" />
      </label>

      <label class="migra-field">
        <span class="migra-field__label">Shadow (rgba)</span>
        <input type="text" class="migra-input w-full" :value="modelValue.shadow" :disabled="disabled" @input="set('shadow', ($event.target as HTMLInputElement).value)" />
      </label>

      <label class="migra-field">
        <span class="migra-field__label">Radius</span>
        <div class="flex items-center gap-3">
          <input
            type="range"
            min="8"
            max="28"
            step="1"
            class="flex-1"
            :value="String(modelValue.radius)"
            :disabled="disabled"
            @input="set('radius', Number(($event.target as HTMLInputElement).value))"
          />
          <span class="text-xs migra-muted w-10 text-right">{{ modelValue.radius }}</span>
        </div>
      </label>

      <div class="migra-theme-preview" :style="previewVars">
        <div class="migra-theme-preview__bar">
          <div class="migra-theme-preview__logo">M</div>
          <div class="min-w-0">
            <div class="font-semibold truncate">Migra Builder</div>
            <div class="text-xs migra-muted truncate">Brand preview</div>
          </div>
          <div class="flex-1"></div>
          <button type="button" class="migra-btn migra-btn--primary text-xs">Primary</button>
        </div>
        <div class="migra-theme-preview__body">
          <div class="migra-theme-preview__card">
            <div class="font-semibold">Card</div>
            <div class="text-xs migra-muted mt-1">Tabs, inputs, and pills inherit tokens</div>
            <div class="migra-row mt-3">
              <span class="migra-btn migra-btn--ghost text-xs">Widgets</span>
              <span class="migra-btn migra-btn--ghost text-xs">Settings</span>
            </div>
            <div class="mt-3">
              <div class="migra-field__label">Input</div>
              <div class="migra-input w-full text-sm">type here…</div>
            </div>
            <div class="mt-3">
              <span class="migra-pill migra-pill--ok"><span class="h-2 w-2 rounded-full bg-emerald-400"></span>Synced</span>
            </div>
          </div>
        </div>
      </div>

      <div class="migra-contrast">
        <div class="migra-h2">Contrast checks</div>
        <div class="text-xs migra-muted mt-1">Common pairings. Aim for AA+.</div>
        <div class="migra-contrast__list">
          <div
            v-for="row in contrastRows"
            :key="row.label"
            class="migra-contrast__row"
            :class="row.grade === 'Fail' ? 'migra-contrast__row--bad' : ''"
          >
            <div class="migra-contrast__label">{{ row.label }}</div>
            <div class="migra-contrast__swatches">
              <span class="migra-contrast__swatch" :style="{ background: row.bg }"></span>
              <span class="migra-contrast__swatch" :style="{ background: row.fg }"></span>
            </div>
            <div class="migra-contrast__meta">
              <span class="migra-badge" :class="row.grade === 'Fail' ? '' : 'migra-badge--accent'">{{ row.grade }}</span>
              <span class="text-xs migra-muted">{{ row.ratio }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ThemeTokens } from '@/core/settings';
import { contrastRatio, fmtRatio, gradeContrast } from '@/core/contrast';
import { autoTuneTheme, DEFAULT_AUTOTUNE, type AutoTuneConfig } from '@/core/autoTheme';
import { useLocalStorageState } from '@/core/useLocalStorageState';
import {
  coerceThemeTokens,
  deletePreset,
  fetchPresets,
  fetchSharedPreset,
  sharePreset,
  upsertPreset,
  type PresetsApiConfig,
  type ThemePreset,
} from '@/core/themePresets';

const props = defineProps<{
  modelValue: ThemeTokens;
  disabled?: boolean;
  canEditGlobal?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: ThemeTokens): void;
  (e: 'reset'): void;
}>();

function set<K extends keyof ThemeTokens>(key: K, value: ThemeTokens[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function newPresetId(): string {
  return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const canEditGlobal = computed(() => Boolean(props.canEditGlobal));
// Standalone: API client is always ready (no WP nonce required)
const restReady = ref(true);
const api = computed<PresetsApiConfig>(() => ({}));

const presetScope = ref<'user' | 'global'>('user');
const presetsUser = ref<ThemePreset[]>([]);
const presetsGlobal = ref<ThemePreset[]>([]);
const loadingPresets = ref(false);
const presetMsg = ref<{ type: 'success' | 'error'; text: string } | null>(null);
const importId = ref('');

const autoCfg = useLocalStorageState<AutoTuneConfig>('migra_autotune_v1', DEFAULT_AUTOTUNE);
const lastBg = ref<string>(props.modelValue.bg);

function sortPresets(list: ThemePreset[]): ThemePreset[] {
  return [...list].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

const activePresets = computed(() => sortPresets(presetScope.value === 'global' ? presetsGlobal.value : presetsUser.value));

async function reloadPresets() {
  if (!restReady.value) {
    presetMsg.value = { type: 'error', text: 'REST not available (missing nonce/url).' };
    window.setTimeout(() => (presetMsg.value = null), 2200);
    return;
  }

  loadingPresets.value = true;
  try {
    const userEnv = await fetchPresets(api.value, 'user');
    presetsUser.value = (userEnv.presets || []).map((p) => ({ ...p, theme: coerceThemeTokens(p.theme, props.modelValue) }));

    if (canEditGlobal.value) {
      const globalEnv = await fetchPresets(api.value, 'global');
      presetsGlobal.value = (globalEnv.presets || []).map((p) => ({ ...p, theme: coerceThemeTokens(p.theme, props.modelValue) }));
    } else {
      presetsGlobal.value = [];
      if (presetScope.value === 'global') presetScope.value = 'user';
    }
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Failed to load presets.' };
  } finally {
    loadingPresets.value = false;
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

function applyPreset(p: ThemePreset) {
  if (props.disabled) return;
  emit('update:modelValue', coerceThemeTokens(p.theme, props.modelValue));
  presetMsg.value = { type: 'success', text: `Applied “${p.name}” (not saved yet).` };
  window.setTimeout(() => (presetMsg.value = null), 2200);
}

async function saveCurrentAsPreset() {
  const name = window.prompt('Preset name?', 'My Preset');
  if (!name) return;

  const scope = presetScope.value === 'global' && canEditGlobal.value ? 'global' : 'user';
  const preset: ThemePreset = {
    id: newPresetId(),
    name,
    theme: { ...props.modelValue },
    createdAt: nowSec(),
    updatedAt: nowSec(),
    pinned: false,
  };

  try {
    const env = await upsertPreset(api.value, scope, preset);
    if (scope === 'global') presetsGlobal.value = env.presets;
    else presetsUser.value = env.presets;
    presetMsg.value = { type: 'success', text: `Saved “${name}”.` };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Failed to save preset.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

async function renamePreset(p: ThemePreset) {
  const name = window.prompt('Rename preset', p.name);
  if (!name || name === p.name) return;

  const scope = presetScope.value === 'global' ? 'global' : 'user';
  try {
    const env = await upsertPreset(api.value, scope, { ...p, name, updatedAt: nowSec() });
    if (scope === 'global') presetsGlobal.value = env.presets;
    else presetsUser.value = env.presets;
    presetMsg.value = { type: 'success', text: 'Renamed.' };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Rename failed.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

async function togglePin(p: ThemePreset) {
  const scope = presetScope.value === 'global' ? 'global' : 'user';
  try {
    const env = await upsertPreset(api.value, scope, { ...p, pinned: !p.pinned, updatedAt: nowSec() });
    if (scope === 'global') presetsGlobal.value = env.presets;
    else presetsUser.value = env.presets;
    presetMsg.value = { type: 'success', text: p.pinned ? 'Unpinned.' : 'Pinned.' };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Pin failed.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

async function deletePresetUi(p: ThemePreset) {
  if (!window.confirm(`Delete preset “${p.name}”?`)) return;
  const scope = presetScope.value === 'global' ? 'global' : 'user';
  try {
    const env = await deletePreset(api.value, scope, p.id);
    if (scope === 'global') presetsGlobal.value = env.presets;
    else presetsUser.value = env.presets;
    presetMsg.value = { type: 'success', text: 'Deleted.' };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Delete failed.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

async function shareLink(p: ThemePreset) {
  try {
    const res = await sharePreset(api.value, p, 60 * 60 * 24 * 14);
    const ok = await copyToClipboard(res.url);
    presetMsg.value = ok ? { type: 'success', text: 'Share link copied.' } : { type: 'success', text: res.url };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Share failed.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2400);
  }
}

async function copyPresetJson(p: ThemePreset) {
  const text = JSON.stringify(p, null, 2);
  const ok = await copyToClipboard(text);
  if (!ok) {
    window.prompt('Copy preset JSON:', text);
    return;
  }
  presetMsg.value = { type: 'success', text: 'Copied preset JSON.' };
  window.setTimeout(() => (presetMsg.value = null), 1800);
}

async function importById() {
  const id = importId.value.trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(id)) {
    presetMsg.value = { type: 'error', text: 'Invalid ID (expects 32 hex chars).' };
    window.setTimeout(() => (presetMsg.value = null), 2400);
    return;
  }

  try {
    const shared = await fetchSharedPreset(api.value, id);
    const preset: ThemePreset = {
      ...shared.preset,
      id: newPresetId(),
      name: `${shared.preset.name} (Imported)`,
      theme: coerceThemeTokens(shared.preset.theme, props.modelValue),
      pinned: true,
      createdAt: nowSec(),
      updatedAt: nowSec(),
    };

    const env = await upsertPreset(api.value, 'user', preset);
    presetsUser.value = env.presets;
    presetScope.value = 'user';
    importId.value = '';
    presetMsg.value = { type: 'success', text: 'Imported into My Presets.' };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Import failed (not found or expired).' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2400);
  }
}

async function importPresetJson() {
  const raw = window.prompt('Paste a preset JSON (or a theme token object) to import:');
  if (!raw) return;

  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    presetMsg.value = { type: 'error', text: 'Invalid JSON.' };
    window.setTimeout(() => (presetMsg.value = null), 2200);
    return;
  }

  const scope = presetScope.value === 'global' && canEditGlobal.value ? 'global' : 'user';

  let preset: ThemePreset;
  if (parsed && typeof parsed === 'object' && parsed.theme) {
    preset = {
      id: String(parsed.id || newPresetId()),
      name: String(parsed.name || 'Imported Preset'),
      theme: coerceThemeTokens(parsed.theme, props.modelValue),
      createdAt: Number(parsed.createdAt || nowSec()),
      updatedAt: nowSec(),
    };
  } else {
    const name = window.prompt('Name for imported theme?', 'Imported Preset');
    if (!name) return;
    preset = {
      id: newPresetId(),
      name,
      theme: coerceThemeTokens(parsed, props.modelValue),
      createdAt: nowSec(),
      updatedAt: nowSec(),
    };
  }

  try {
    const env = await upsertPreset(api.value, scope, preset);
    if (scope === 'global') presetsGlobal.value = env.presets;
    else presetsUser.value = env.presets;
    presetMsg.value = { type: 'success', text: 'Imported.' };
  } catch (e: any) {
    presetMsg.value = { type: 'error', text: e?.message || 'Import failed.' };
  } finally {
    window.setTimeout(() => (presetMsg.value = null), 2200);
  }
}

type ContrastRow = { label: string; fg: string; bg: string; kind: 'normal' | 'large' };
type ContrastRowView = ContrastRow & { ratio: string; grade: ReturnType<typeof gradeContrast> };

const previewVars = computed(() => ({
  '--migra-accent': props.modelValue.accent,
  '--migra-accent2': props.modelValue.accent2,
  '--migra-bg': props.modelValue.bg,
  '--migra-panel': props.modelValue.panel,
  '--migra-panel2': props.modelValue.panel2,
  '--migra-text': props.modelValue.text,
  '--migra-muted': props.modelValue.muted,
  '--migra-border': props.modelValue.border,
  '--migra-shadow': props.modelValue.shadow,
  '--migra-radius': `${props.modelValue.radius}px`,
}));

const rows = computed<ContrastRow[]>(() => [
  { label: 'Text on Background', fg: props.modelValue.text, bg: props.modelValue.bg, kind: 'normal' },
  { label: 'Text on Panel', fg: props.modelValue.text, bg: props.modelValue.panel, kind: 'normal' },
  { label: 'Muted on Panel', fg: props.modelValue.muted, bg: props.modelValue.panel, kind: 'normal' },
  { label: 'Accent on Background (large)', fg: props.modelValue.accent, bg: props.modelValue.bg, kind: 'large' },
  { label: 'Accent2 on Background (large)', fg: props.modelValue.accent2, bg: props.modelValue.bg, kind: 'large' },
]);

const contrastRows = computed<ContrastRowView[]>(() =>
  rows.value.map((r) => {
    const ratioVal = contrastRatio(r.fg, r.bg);
    const grade = ratioVal == null ? 'Fail' : gradeContrast(ratioVal, r.kind);
    return { ...r, ratio: fmtRatio(ratioVal), grade };
  })
);

const failedRows = computed(() => contrastRows.value.filter((r) => r.grade === 'Fail'));

onMounted(() => {
  reloadPresets();
});

function applyAutoTuneNow() {
  if (!autoCfg.value.enabled) return;
  emit('update:modelValue', autoTuneTheme(props.modelValue, autoCfg.value));
  presetMsg.value = { type: 'success', text: 'Auto-Tune applied.' };
  window.setTimeout(() => (presetMsg.value = null), 1800);
}

watch(
  () => props.modelValue.bg,
  (bg) => {
    if (!autoCfg.value.enabled) {
      lastBg.value = bg;
      return;
    }
    if (bg === lastBg.value) return;
    lastBg.value = bg;
    emit('update:modelValue', autoTuneTheme(props.modelValue, autoCfg.value));
  },
);
</script>
