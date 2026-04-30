<template>
  <div class="mt-4">
    <div class="flex items-center justify-between gap-3">
      <div>
        <div class="font-extrabold">Keybindings</div>
        <div v-if="readOnly" class="text-xs migra-muted">Global keybindings are read-only for your role.</div>
        <div v-else class="text-xs migra-muted">
          Use tokens like <span class="font-semibold">Mod</span>, <span class="font-semibold">Shift</span>, <span class="font-semibold">Alt</span>
          (e.g. <span class="font-semibold">Mod+Shift+ArrowUp</span>).
        </div>
      </div>
      <button
        v-if="capturing"
        type="button"
        class="migra-btn migra-btn--ghost text-xs"
        @click="cancelCapture"
      >
        Cancel (Esc)
      </button>
    </div>

    <div v-if="conflicts.length" class="mt-3 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
      <div class="font-extrabold">Conflicts detected</div>
      <div class="mt-1 text-amber-100/90">Two or more actions share the same combo. Fix these to avoid unpredictable behavior.</div>
      <div class="mt-2 grid gap-1 text-amber-100/90">
        <div v-for="c in conflicts.slice(0, 6)" :key="c.combo">
          <span class="font-extrabold">{{ c.combo }}</span> → {{ c.actions.join(', ') }}
        </div>
        <div v-if="conflicts.length > 6">…and {{ conflicts.length - 6 }} more</div>
      </div>
    </div>

    <div
      v-if="capturing"
      class="migra-softcard mt-3 rounded-2xl px-3 py-2 text-xs"
    >
      Capturing for <span class="font-extrabold">{{ capturing }}</span>. Press keys now (Esc to cancel).
    </div>

    <label class="mt-3 block">
      <span class="text-xs migra-muted">Search</span>
      <input
        v-model="query"
        type="text"
        placeholder="Filter by action, help text, or combo…"
        class="migra-input mt-1 w-full text-sm"
      />
    </label>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="migra-btn migra-btn--ghost text-xs"
        @click="exportJson"
      >
        Export JSON
      </button>
      <button
        type="button"
        class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
        :disabled="readOnly || !importRaw.trim()"
        @click="applyImport"
      >
        Import JSON
      </button>
      <button
        type="button"
        class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
        :disabled="readOnly"
        @click="normalizeAll"
      >
        Normalize combos
      </button>
    </div>

    <label class="mt-3 block">
      <span class="text-xs migra-muted">Import box</span>
      <textarea
        v-model="importRaw"
        rows="5"
        class="migra-input mt-1 w-full resize-y text-xs disabled:opacity-60"
        :disabled="readOnly"
        placeholder='Paste JSON object: { "moveUp": "ArrowUp", ... } (partial allowed)'
      />
      <div v-if="importError" class="mt-2 text-xs text-amber-300">{{ importError }}</div>
    </label>

    <div class="mt-3 grid gap-3">
      <div
        v-for="row in filteredRows"
        :key="row.id"
        class="migra-softcard rounded-2xl p-3"
        :class="rowConflict(row.id) ? 'migra-softcard--warn' : ''"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-extrabold">
              {{ row.label }}
              <span v-if="rowConflict(row.id)" class="ml-2 text-[11px] font-semibold text-amber-200">
                conflicts with: {{ rowConflict(row.id)?.join(', ') }}
              </span>
            </div>
            <div class="text-xs migra-muted">{{ row.help }}</div>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
              :disabled="readOnly || !!capturing"
              @click="startCapture(row.id)"
            >
              Capture
            </button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
              :disabled="readOnly"
              @click="clear(row.id)"
            >
              Clear
            </button>
          </div>
        </div>

        <div class="mt-3">
          <input
            class="migra-input w-full text-sm disabled:opacity-60"
            :disabled="readOnly"
            :value="modelValue[row.id] || ''"
            @input="(e) => update(row.id, (e.target as HTMLInputElement).value)"
          />
          <div v-if="rowCanon(row.id)" class="mt-1 text-[11px] migra-muted">
            Canonical: <span class="font-semibold">{{ rowCanon(row.id) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { KeybindingAction, Keybindings } from '@/core/settings';
import { canonicalizeCombo, comboFromEvent, KEYBINDING_ACTIONS } from '@/core/settings';

const props = defineProps<{
  modelValue: Keybindings;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: Keybindings): void;
}>();

const rows = computed(() => KEYBINDING_ACTIONS);
const capturing = ref<KeybindingAction | null>(null);
const query = ref('');
const importRaw = ref('');
const importError = ref<string | null>(null);

function startCapture(action: KeybindingAction) {
  capturing.value = action;
}

function cancelCapture() {
  capturing.value = null;
}

function update(action: KeybindingAction, value: string) {
  emit('update:modelValue', { ...props.modelValue, [action]: value });
}

function clear(action: KeybindingAction) {
  emit('update:modelValue', { ...props.modelValue, [action]: '' });
}

const comboMap = computed(() => {
  const m = new Map<string, KeybindingAction[]>();
  (Object.keys(props.modelValue) as KeybindingAction[]).forEach((action) => {
    const raw = String(props.modelValue[action] || '').trim();
    const canon = canonicalizeCombo(raw);
    if (!canon) return;
    const list = m.get(canon) ?? [];
    list.push(action);
    m.set(canon, list);
  });
  return m;
});

const conflicts = computed(() => {
  const out: Array<{ combo: string; actions: KeybindingAction[] }> = [];
  comboMap.value.forEach((actions, combo) => {
    if (actions.length > 1) out.push({ combo, actions });
  });
  return out.sort((a, b) => a.combo.localeCompare(b.combo));
});

function rowCanon(action: KeybindingAction): string {
  const raw = String(props.modelValue[action] || '').trim();
  return canonicalizeCombo(raw);
}

function rowConflict(action: KeybindingAction): KeybindingAction[] | null {
  const canon = rowCanon(action);
  if (!canon) return null;
  const actions = comboMap.value.get(canon) ?? [];
  if (actions.length <= 1) return null;
  return actions.filter((a) => a !== action);
}

const filteredRows = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return rows.value;
  return rows.value.filter((r) => {
    const combo = String(props.modelValue[r.id] || '').toLowerCase();
    return (
      r.label.toLowerCase().includes(q) ||
      r.help.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      combo.includes(q)
    );
  });
});

async function exportJson() {
  importError.value = null;
  const payload = JSON.stringify(props.modelValue, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
  } catch {
    importRaw.value = payload;
    importError.value = 'Clipboard blocked. JSON copied into the import box instead.';
  }
}

function applyImport() {
  importError.value = null;
  const raw = importRaw.value.trim();
  if (!raw) return;
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    importError.value = e?.message ? `Invalid JSON: ${e.message}` : 'Invalid JSON';
    return;
  }
  if (!parsed || typeof parsed !== 'object') {
    importError.value = 'JSON must be an object';
    return;
  }
  const next = { ...props.modelValue };
  (Object.keys(next) as KeybindingAction[]).forEach((k) => {
    const v = (parsed as any)[k];
    if (typeof v === 'string') next[k] = v;
  });
  emit('update:modelValue', next);
}

function normalizeAll() {
  if (props.readOnly) return;
  const next = { ...props.modelValue };
  (Object.keys(next) as KeybindingAction[]).forEach((k) => {
    const raw = String(next[k] || '').trim();
    if (!raw) return;
    const canon = canonicalizeCombo(raw);
    if (canon) next[k] = canon;
  });
  emit('update:modelValue', next);
}

function onKeyDown(e: KeyboardEvent) {
  if (!capturing.value) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelCapture();
    return;
  }
  const combo = comboFromEvent(e);
  if (!combo) return;
  e.preventDefault();
  update(capturing.value, combo);
  capturing.value = null;
}

onMounted(() => window.addEventListener('keydown', onKeyDown, { capture: true }));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown, { capture: true } as any));
</script>
