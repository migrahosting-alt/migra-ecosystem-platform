<template>
  <div class="p-4 migra-stack migra-stack--lg">
    <MigraCard v-if="!node" eyebrow="Inspector" title="No selection" subtitle="Select an element to edit its settings.">
      <div class="text-sm migra-muted">Tip: use the Navigator tab to select nested elements.</div>
    </MigraCard>

    <MigraCard
      v-else
      eyebrow="Selected"
      :title="widget?.title || node.type"
      :subtitle="node.id"
    />

    <MigraCard
      v-if="node && (locked || hidden)"
      eyebrow="Guard"
      :title="hidden ? 'Hidden element' : lockState === 'inherited' ? 'Locked (inherited)' : 'Locked element'"
      :subtitle="
        hidden
          ? 'Unhide to edit or drag.'
          : lockState === 'inherited'
            ? 'Unlock the parent to edit or drag.'
            : 'Unlock to edit or drag.'
      "
    >
      <div class="migra-stack migra-stack--sm">
        <div class="text-xs migra-muted">
          Locked/hidden elements are selectable, but their controls and inline editing are disabled.
        </div>
        <div class="migra-row">
          <button
            v-if="locked && lockState !== 'inherited'"
            type="button"
            class="migra-btn migra-btn--primary text-xs"
            @click="unlockNode"
          >
            Unlock
          </button>
          <button
            v-else-if="locked && lockState === 'inherited' && lockingAncestorId"
            type="button"
            class="migra-btn migra-btn--primary text-xs"
            @click="emit('select', lockingAncestorId)"
          >
            Select locking parent
          </button>
          <button v-if="hidden" type="button" class="migra-btn migra-btn--primary text-xs" @click="unhideNode">
            Unhide
          </button>
        </div>
      </div>
    </MigraCard>

    <MigraCard v-if="node && widget" eyebrow="Content" title="Properties">
      <div class="migra-stack">
        <div
          v-if="node.type === 'site-logo' && String(getValue('mode') ?? 'wp') === 'wp'"
          class="migra-theme-warn"
        >
          <div class="text-sm font-semibold">WordPress Custom Logo</div>
          <div class="text-xs migra-muted">
            This widget can read the theme’s Custom Logo. Admins can set it from here.
          </div>
          <div class="migra-row" style="margin-top: var(--s-2);">
            <button
              type="button"
              class="migra-btn migra-btn--primary text-xs"
              :disabled="readOnly || !siteBranding.canManage"
              @click="setWpCustomLogo"
            >
              Set WP Logo…
            </button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :disabled="readOnly || !siteBranding.canManage || !siteBranding.siteIconUrl"
              @click="removeWpCustomLogo"
            >
              Remove
            </button>
            <div class="text-xs migra-muted">
              <span v-if="!siteBranding.canManage">Requires admin.</span>
              <span v-else-if="siteBranding.siteIconUrl">Set</span>
              <span v-else>Not set.</span>
            </div>
          </div>
        </div>

        <fieldset class="migra-stack" :disabled="readOnly">
        <template v-for="field in widget.fields" :key="field.key">
          <label v-if="field.kind === 'text'" class="block">
            <span class="migra-field__label">{{ field.label }}</span>
            <input
              type="text"
              class="migra-input w-full text-sm"
              :placeholder="field.placeholder"
              :value="String(getValue(field.key) ?? '')"
              @input="(e) => setValue(field.key, (e.target as HTMLInputElement).value)"
            />
          </label>

          <label v-else-if="field.kind === 'textarea'" class="block">
            <span class="migra-field__label">{{ field.label }}</span>
            <textarea
              class="migra-input w-full text-sm"
              :rows="field.rows || 5"
              :placeholder="field.placeholder"
              :value="String(getValue(field.key) ?? '')"
              @input="(e) => setValue(field.key, (e.target as HTMLTextAreaElement).value)"
            ></textarea>
          </label>

          <label v-else-if="field.kind === 'number'" class="block">
            <span class="migra-field__label">{{ field.label }}</span>
            <input
              type="number"
              class="migra-input w-full text-sm"
              :min="field.min"
              :max="field.max"
              :step="field.step || 1"
              :value="String(getValue(field.key) ?? 0)"
              @input="(e) => setValue(field.key, Number((e.target as HTMLInputElement).value))"
            />
          </label>

          <label v-else-if="field.kind === 'color'" class="block">
            <span class="migra-field__label">{{ field.label }}</span>
            <div class="migra-color">
              <input
                type="color"
                class="migra-color__swatch"
                :value="String(getValue(field.key) ?? '#0f172a')"
                @input="(e) => setValue(field.key, (e.target as HTMLInputElement).value)"
              />
              <input
                type="text"
                class="migra-input flex-1 text-sm"
                :value="String(getValue(field.key) ?? '#0f172a')"
                @input="(e) => setValue(field.key, (e.target as HTMLInputElement).value)"
              />
            </div>
          </label>

          <div v-else-if="field.kind === 'media' && isMediaVisible(field)" class="migra-stack migra-stack--sm">
            <div class="flex items-center justify-between gap-3">
              <span class="migra-field__label">{{ field.label }}</span>
              <div class="migra-row">
                <button type="button" class="migra-btn migra-btn--ghost text-xs" @click="chooseMedia(field)">
                  Choose…
                </button>
                <button
                  type="button"
                  class="migra-btn migra-btn--ghost text-xs"
                  :disabled="!String(getValue(`${field.key}.url`) ?? '').trim()"
                  @click="clearMedia(field)"
                >
                  Clear
                </button>
              </div>
            </div>

            <input
              type="text"
              class="migra-input w-full text-sm"
              :placeholder="(field as any).placeholder || 'https://…'"
              :value="String(getValue(`${field.key}.url`) ?? '')"
              @input="(e) => setValue(`${field.key}.url`, (e.target as HTMLInputElement).value)"
            />

            <div v-if="String(getValue(`${field.key}.url`) ?? '').trim()" class="text-xs migra-muted">
              Selected ID: {{ Number(getValue(`${field.key}.id`) ?? 0) || 0 }}
            </div>
          </div>

          <div v-else-if="field.kind === 'spacing'" class="migra-stack migra-stack--sm">
            <div class="flex items-center justify-between gap-3">
              <span class="migra-field__label">{{ field.label }}</span>
              <button
                type="button"
                class="migra-btn migra-btn--ghost text-xs"
                @click="() => toggleLinked(field)"
              >
                {{
                  isLinked(field) ? 'Linked' : 'Unlinked'
                }}
              </button>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="text-xs migra-muted">Top</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step || 1"
                  :value="String(toNumber(getValue(field.keys.top), 0))"
                  @input="(e) => updateSpacing(field, 'top', Number((e.target as HTMLInputElement).value))"
                />
              </label>
              <label class="block">
                <span class="text-xs migra-muted">Right</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step || 1"
                  :value="String(toNumber(getValue(field.keys.right), 0))"
                  @input="(e) => updateSpacing(field, 'right', Number((e.target as HTMLInputElement).value))"
                />
              </label>
              <label class="block">
                <span class="text-xs migra-muted">Bottom</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step || 1"
                  :value="String(toNumber(getValue(field.keys.bottom), 0))"
                  @input="(e) => updateSpacing(field, 'bottom', Number((e.target as HTMLInputElement).value))"
                />
              </label>
              <label class="block">
                <span class="text-xs migra-muted">Left</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.min"
                  :max="field.max"
                  :step="field.step || 1"
                  :value="String(toNumber(getValue(field.keys.left), 0))"
                  @input="(e) => updateSpacing(field, 'left', Number((e.target as HTMLInputElement).value))"
                />
              </label>
            </div>

            <div v-if="field.help" class="text-xs migra-muted">{{ field.help }}</div>
          </div>

          <div v-else-if="field.kind === 'typography'" class="migra-stack migra-stack--sm">
            <div class="migra-field__label">{{ field.label }}</div>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="text-xs migra-muted">Size</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.size?.min"
                  :max="field.size?.max"
                  :step="field.size?.step || 1"
                  :value="String(toNumber(getValue(field.keys.size), 16))"
                  @input="(e) => setValue(field.keys.size, Number((e.target as HTMLInputElement).value))"
                />
              </label>

              <label class="block">
                <span class="text-xs migra-muted">Weight</span>
                <select
                  class="migra-input w-full text-sm"
                  :value="String(getValue(field.keys.weight) ?? '600')"
                  @change="(e) => setValue(field.keys.weight, (e.target as HTMLSelectElement).value)"
                >
                  <option v-for="w in FONT_WEIGHTS" :key="String(w.value)" :value="String(w.value)">
                    {{ w.label }}
                  </option>
                </select>
              </label>

              <label v-if="field.keys.lineHeight" class="block">
                <span class="text-xs migra-muted">Line height</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.lineHeight?.min"
                  :max="field.lineHeight?.max"
                  :step="field.lineHeight?.step || 0.05"
                  :value="String(toNumber(getValue(field.keys.lineHeight), 1.2))"
                  @input="(e) => setValue(field.keys.lineHeight!, Number((e.target as HTMLInputElement).value))"
                />
              </label>

              <label v-if="field.keys.letterSpacing" class="block">
                <span class="text-xs migra-muted">Letter spacing</span>
                <input
                  type="number"
                  class="migra-input w-full text-sm"
                  :min="field.letterSpacing?.min"
                  :max="field.letterSpacing?.max"
                  :step="field.letterSpacing?.step || 0.1"
                  :value="String(toNumber(getValue(field.keys.letterSpacing), 0))"
                  @input="(e) => setValue(field.keys.letterSpacing!, Number((e.target as HTMLInputElement).value))"
                />
              </label>

              <label v-if="field.keys.align" class="block">
                <span class="text-xs migra-muted">Align</span>
                <select
                  class="migra-input w-full text-sm"
                  :value="String(getValue(field.keys.align) ?? 'left')"
                  @change="(e) => setValue(field.keys.align!, (e.target as HTMLSelectElement).value)"
                >
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>

            <div v-if="field.help" class="text-xs migra-muted">{{ field.help }}</div>
          </div>

          <label v-else-if="field.kind === 'toggle'" class="flex items-center justify-between gap-3">
            <span class="text-sm">{{ field.label }}</span>
            <input
              type="checkbox"
              class="migra-checkbox h-5 w-5"
              :checked="Boolean(getValue(field.key))"
              @change="(e) => setValue(field.key, (e.target as HTMLInputElement).checked)"
            />
          </label>

          <label v-else-if="field.kind === 'select'" class="block">
            <span class="migra-field__label">{{ field.label }}</span>
            <select
              class="migra-input w-full text-sm"
              :value="String(getValue(field.key) ?? '')"
              @change="(e) => setValue(field.key, (e.target as HTMLSelectElement).value)"
            >
              <option v-for="opt in field.options" :key="String(opt.value)" :value="String(opt.value)">
                {{ opt.label }}
              </option>
            </select>
          </label>
        </template>
        </fieldset>
      </div>
    </MigraCard>

    <MigraCard v-else-if="node" eyebrow="Content" title="Properties (Raw)">
      <div class="migra-stack migra-stack--sm">
        <div class="text-xs migra-muted">
          No structured inspector for this widget yet. Edit raw props JSON (advanced).
        </div>
        <textarea
          class="migra-input w-full text-sm"
          style="min-height: 160px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;"
          :value="rawJson"
          :disabled="readOnly"
          @input="(e) => updateRawJson((e.target as HTMLTextAreaElement).value)"
        />
        <div v-if="rawError" class="text-xs" style="color: #fca5a5;">{{ rawError }}</div>
      </div>
    </MigraCard>

    <MigraCard v-if="node" eyebrow="Advanced" title="CSS">
      <fieldset class="migra-stack" :disabled="readOnly">
        <label class="block">
          <span class="migra-field__label">CSS ID</span>
          <input
            type="text"
            class="migra-input w-full text-sm"
            :value="String(getValue('css_id') ?? '')"
            placeholder="Optional ID"
            @input="(e) => setValue('css_id', (e.target as HTMLInputElement).value)"
          />
        </label>
        <label class="block">
          <span class="migra-field__label">CSS Classes</span>
          <input
            type="text"
            class="migra-input w-full text-sm"
            :value="String(getValue('css_classes') ?? '')"
            placeholder="class-one class-two"
            @input="(e) => setValue('css_classes', (e.target as HTMLInputElement).value)"
          />
        </label>
      </fieldset>
    </MigraCard>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { DocNode } from '@/core/document';
import type { WidgetDefinition } from '@/core/widgets';
import MigraCard from '@/ui/MigraCard.vue';
import { pickMedia } from '@/core/wpMedia';
import { setSiteBranding, siteBranding } from '@/core/siteBrandingStore';

const props = defineProps<{
  node: DocNode | null;
  widget: WidgetDefinition | null;
  lockState?: 'none' | 'own' | 'inherited';
  lockingAncestorId?: string | null;
}>();

const emit = defineEmits<{
  (e: 'patch', payload: { id: string; patch: Record<string, any> }): void;
  (e: 'select', id: string): void;
}>();

const FONT_WEIGHTS = [
  { label: '300', value: '300' },
  { label: '400', value: '400' },
  { label: '500', value: '500' },
  { label: '600', value: '600' },
  { label: '700', value: '700' },
  { label: '800', value: '800' },
  { label: '900', value: '900' },
];

const rawError = ref('');

const rawJson = computed(() => {
  const obj = (props.node?.props || {}) as any;
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '{}';
  }
});

function isNodeHidden(node: DocNode): boolean {
  const p = (node.props ?? {}) as Record<string, any>;
  if (p.hidden === true || p.isHidden === true || p.mgHidden === true) return true;
  const vis = String(p.visibility ?? '').toLowerCase();
  if (vis === 'hidden') return true;
  const disp = String(p.display ?? '').toLowerCase();
  if (disp === 'none') return true;
  return false;
}

const lockState = computed<'none' | 'own' | 'inherited'>(() => {
  if (props.lockState) return props.lockState;
  const p = (props.node?.props ?? {}) as Record<string, any>;
  const own = Boolean(p.locked === true || p.isLocked === true || p.mgLocked === true);
  return own ? 'own' : 'none';
});

const lockingAncestorId = computed(() => props.lockingAncestorId ?? null);
const locked = computed(() => Boolean(props.node && lockState.value !== 'none'));
const hidden = computed(() => Boolean(props.node && isNodeHidden(props.node)));
const readOnly = computed(() => locked.value || hidden.value);

function unlockNode() {
  if (!props.node) return;
  emit('patch', { id: props.node.id, patch: { locked: false, isLocked: false, mgLocked: false } });
}

function unhideNode() {
  if (!props.node) return;
  emit('patch', {
    id: props.node.id,
    patch: { hidden: false, isHidden: false, mgHidden: false, visibility: undefined, display: undefined },
  });
}

function getValue(path: string): any {
  const obj = (props.node?.props || {}) as any;
  if (!path.includes('.')) return obj[path];
  return path.split('.').reduce((acc, key) => (acc && typeof acc === 'object' ? acc[key] : undefined), obj);
}

function toNumber(value: any, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function setMany(patch: Record<string, any>) {
  if (!props.node) return;
  const clean = { ...patch };
  delete (clean as any).__ignore;
  if (Object.keys(clean).length === 0) return;
  emit('patch', { id: props.node.id, patch: clean });
}

function setValue(path: string, value: any) {
  if (!props.node) return;

  if (!path.includes('.')) {
    emit('patch', { id: props.node.id, patch: { [path]: value } });
    return;
  }

  const parts = path.split('.');
  const rootKey = parts[0];
  const currentRoot = (props.node.props || {})[rootKey];
  const nextRoot = currentRoot && typeof currentRoot === 'object' ? { ...currentRoot } : {};

  let cursor: any = nextRoot;
  for (let i = 1; i < parts.length - 1; i += 1) {
    const k = parts[i];
    cursor[k] = cursor[k] && typeof cursor[k] === 'object' ? { ...cursor[k] } : {};
    cursor = cursor[k];
  }
  cursor[parts[parts.length - 1]] = value;

  emit('patch', { id: props.node.id, patch: { [rootKey]: nextRoot } });
}

function updateSpacing(
  field: any,
  side: 'top' | 'right' | 'bottom' | 'left',
  nextValue: number,
) {
  if (!props.node) return;
  const linked = isLinked(field);

  const patch: Record<string, any> = {};
  if (linked) {
    patch[field.keys.top] = nextValue;
    patch[field.keys.right] = nextValue;
    patch[field.keys.bottom] = nextValue;
    patch[field.keys.left] = nextValue;
  } else {
    patch[field.keys[side]] = nextValue;
  }
  setMany(patch);
}

function isLinked(field: any): boolean {
  const linkedKey = field?.keys?.linked;
  if (!linkedKey) return true;
  const v = getValue(linkedKey);
  return v == null ? true : Boolean(v);
}

function toggleLinked(field: any) {
  const linkedKey = field?.keys?.linked;
  if (!linkedKey) return;
  setMany({ [linkedKey]: !isLinked(field) });
}

function updateRawJson(next: string) {
  if (!props.node) return;
  rawError.value = '';
  try {
    const parsed = JSON.parse(next || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      rawError.value = 'Props must be a JSON object.';
      return;
    }
    emit('patch', { id: props.node.id, patch: parsed });
  } catch (e: any) {
    rawError.value = 'Invalid JSON.';
  }
}

function isMediaVisible(field: any): boolean {
  if (!props.node) return true;
  if (props.node.type === 'site-logo' && field?.key === 'image') {
    const mode = String(getValue('mode') ?? 'wp');
    return mode === 'custom';
  }
  return true;
}

async function chooseMedia(field: any) {
  const picked = await pickMedia({
    title: field?.label || 'Select media',
    button: 'Use this',
    libraryType: field?.libraryType || 'any',
  });
  if (!picked) return;
  setValue(String(field.key || ''), { id: picked.id, url: picked.url, alt: picked.alt || '' });
}

function clearMedia(field: any) {
  setValue(String(field.key || ''), { id: 0, url: '', alt: '' });
}

async function setWpCustomLogo() {
  const picked = await pickMedia({ title: 'Select site logo', button: 'Set as Custom Logo', libraryType: 'image' });
  if (!picked) return;
  await setSiteBranding({ logoUrl: picked.url });
}

async function removeWpCustomLogo() {
  await setSiteBranding({ logoUrl: null });
}
</script>
