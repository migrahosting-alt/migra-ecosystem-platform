<template>
  <div class="migra-builder-root migra-editor flex h-screen" :style="themeVars">
    <CommandPalette :open="paletteOpen" :items="paletteItems" @close="paletteOpen = false" />

    <aside class="migra-sidebar flex flex-col" :style="{ width: `${leftWidth}px` }">
      <header class="migra-sidebar__header flex items-center justify-between px-4 py-3">
        <div class="flex items-center gap-2">
          <img
            v-if="brandLogoUrl"
            :src="brandLogoUrl"
            alt="Brand"
            class="migra-brand__logoimg h-9 w-9"
            draggable="false"
          />
          <span
            v-else
            class="migra-brand__logo h-9 w-9 flex items-center justify-center text-lg font-semibold"
          >
            M
          </span>
          <div>
            <p class="text-sm font-semibold">{{ documentTitle }}</p>
            <p class="text-xs migra-muted">Enterprise page builder</p>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="migra-btn migra-btn--ghost text-xs"
            title="Command palette (Ctrl/Cmd+K)"
            @click="paletteOpen = true"
          >
            ⌘K
          </button>
          <button
            class="migra-btn migra-btn--primary text-xs disabled:opacity-60 disabled:cursor-not-allowed"
            :disabled="saving"
            @click="saveDraft"
          >
            {{ saving ? 'Saving…' : 'Save' }}
          </button>
        </div>
      </header>

      <nav class="migra-tabs flex px-4">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          :class="[
            'flex-1 py-3 text-center text-xs font-semibold tracking-wide transition migra-tab',
            activeTab === tab.key ? 'migra-tab--active' : 'migra-tab--inactive'
          ]"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </nav>

      <div class="flex-1 overflow-y-auto">
        <WidgetLibrary
          v-if="activeTab === 'widgets'"
          :widgets="widgets"
          :categories="categories"
          @add="handleAddWidget"
        />
	        <InspectorPanel
	          v-else-if="activeTab === 'settings'"
	          :node="selectedNode"
	          :widget="selectedWidgetDef"
            :lock-state="selectedNode ? getLockState(selectedNode.id) : 'none'"
            :locking-ancestor-id="selectedNode ? findLockingAncestorId(selectedNode.id) : null"
            @select="handleSelectElement"
	          @patch="handlePatchNode"
	        />
	        <PreferencesPanel
	          v-else-if="activeTab === 'prefs'"
	          :env="settingsEnv"
	          @update="handleSettingsUpdate"
	          @preview-theme="handlePreviewTheme"
	          @show-hint="showHintAgain"
	          @dismiss-hint="dismissHintLocal"
	        />
	        <Navigator
	          v-else-if="activeTab === 'navigator'"
	          :doc="doc"
	          :selected-id="selectedElementId"
            :selected-ids="selectionAsArray()"
	          :keybindings="settingsEnv.effective.keybindings"
	          :teleport-wrap="settingsEnv.effective.teleportWrap"
	          @select="handleSelectElement"
	          @move="handleMoveNode"
            @toggle-lock="handleToggleLockSelection"
            @toggle-hidden="handleToggleHiddenSelection"
            @duplicate="handleDuplicateNodeById"
            @delete="handleDeleteNodeById"
	        />
	        <HistoryPanel
	          v-else
	          :history="history"
	          :current-index="historyIndex"
	          @jump="jumpToHistory"
	        />
      </div>

      <footer class="migra-sidebar__footer px-4 py-3 text-xs flex items-center justify-between">
        <span class="flex items-center gap-2 min-w-0">
          <span class="truncate">{{ statusText }}</span>
          <span v-if="buildId" class="migra-muted truncate">• {{ buildId }}</span>
        </span>
        <div class="flex items-center gap-2">
          <button
            class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
            :disabled="!canUndo"
            @click="undo"
          >
            Undo
          </button>
          <button
            class="migra-btn migra-btn--ghost text-xs disabled:opacity-50"
            :disabled="!canRedo"
            @click="redo"
          >
            Redo
          </button>
        </div>
      </footer>
    </aside>

    <div
      class="migra-resize-handle"
      :class="isResizing ? 'migra-resize-handle--active' : ''"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      @pointerdown.prevent="startResize"
    ></div>

	    <main class="migra-main flex-1 p-6 relative">
	      <div class="migra-canvas-card rounded-3xl min-h-full flex flex-col">
	        <div class="migra-canvas-card__header flex items-center justify-between px-6 py-4">
	          <div>
	            <p class="text-xs uppercase tracking-[0.3em] migra-muted">Preview</p>
	            <h1 class="text-2xl font-semibold">Studio Canvas</h1>
          </div>
          <div class="flex items-center gap-3 text-xs migra-muted">
            <span class="migra-btn migra-btn--ghost text-xs flex items-center gap-1">
              <span class="h-2 w-2 rounded-full" :class="saving ? 'bg-amber-400' : 'bg-emerald-400'"></span>
              {{ statusText === 'Saved' ? 'Synced' : statusText }}
            </span>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              @click="previewMode = previewMode === 'canvas' ? 'live' : 'canvas'"
            >
              {{ previewMode === 'canvas' ? 'Canvas' : 'Live' }}
            </button>
            <span class="migra-btn migra-btn--ghost text-xs">Desktop</span>
          </div>
        </div>

	        <div class="flex-1 p-6">
	          <Canvas
	            v-if="previewMode === 'canvas'"
	            :doc="doc"
	            :selected-id="selectedElementId"
              :selected-ids="selectionAsArray()"
              :inline-edit="inlineEdit"
              :widgets="widgets"
	            @select="(p) => handleSelectRequest(p, { source: 'canvas' })"
              @set-selection="handleSetSelection"
              @move="handleMoveNode"
              @move-group="handleMoveGroup"
              @add-widget-at="handleAddWidgetAt"
              @move-relative="(p) => handleMoveSelectionRelative(p.delta, p.id)"
              @indent="(id) => handleIndentSelection(id)"
              @outdent="(id) => handleOutdentSelection(id)"
              @toggle-lock="handleToggleLockSelection"
              @toggle-hidden="handleToggleHiddenSelection"
              @duplicate="(id) => handleDuplicateSelection(id)"
              @delete="(id) => handleDeleteSelection(id)"
              @inline-start="handleInlineStart"
              @inline-commit="handleInlineCommit"
              @inline-cancel="handleInlineCancel"
	          />
	          <PreviewFrame v-else-if="previewUrl" :preview-url="previewUrl" :elements="legacyElements" />
	          <CanvasPlaceholder v-else />
	        </div>
	      </div>

	      <ShortcutsHint
	        v-if="showShortcutsHint"
	        :keybindings="settingsEnv.effective.keybindings"
	        @dismiss="dismissHintLocal"
	      />
	    </main>
	  </div>
	</template>

<script setup lang="ts">
	import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
	import CommandPalette, { type PaletteItem } from './CommandPalette.vue';
	import InspectorPanel from './InspectorPanel.vue';
	import Navigator from './Navigator.vue';
	import HistoryPanel from './HistoryPanel.vue';
	import CanvasPlaceholder from './CanvasPlaceholder.vue';
	import PreferencesPanel from './PreferencesPanel.vue';
	import ShortcutsHint from './ShortcutsHint.vue';
	import WidgetLibrary, { type WidgetDefinition, type CategoryDefinition } from './WidgetLibrary.vue';
	import PreviewFrame from './PreviewFrame.vue';
	import { addNode, createEmptyDoc, deleteNode, docToLegacy, duplicateNode, findParentId, isDescendant, isDoc, legacyToDoc, makeId, moveNode, patchNodeProps, unwrapNode, wrapNode, type DocNode, type MigraDoc } from '@/core/document';
	import { getWidgetDefinition } from '@/core/widgets';
	import Canvas from './Canvas.vue';
	import { DEFAULT_SETTINGS_ENVELOPE, DEFAULT_THEME, ensureReadableThemeTokens, type SettingsEnvelope, type ThemeTokens } from '@/core/settings';
	import { computeTheme, toCssVars } from '@/core/themeEngine';
  import { useLocalStorageState } from '@/core/useLocalStorageState';
  import { initSiteBranding, loadSiteBranding, siteBranding } from '@/core/siteBrandingStore';
  import { resolveInlineEditSpec, type InlineEditSpec } from '@/core/inlineEdit';

	const tabs = [
	  { key: 'widgets', label: 'Widgets' },
	  { key: 'settings', label: 'Settings' },
	  { key: 'prefs', label: 'Prefs' },
	  { key: 'navigator', label: 'Navigator' },
	  { key: 'history', label: 'History' }
	];

const activeTab = useLocalStorageState<string>('migra_left_tab_v1', 'widgets');
const previewMode = ref<'canvas' | 'live'>('canvas');
const leftWidth = useLocalStorageState<number>('migra_left_width_v1', 288);
const isResizing = ref(false);

type EditorElement = {
  id: string;
  widgetType: string;
  settings?: Record<string, any>;
  elements?: EditorElement[];
};

// Standalone config — passed from EditorView via props
const props = defineProps<{
  siteId: string;
  pageId: string;
  pageTitle?: string;
  initialDoc?: MigraDoc | null;
}>();

const documentTitle = computed(() => props.pageTitle || 'MigraBuilder');
const buildId = computed(() => '0.1.0');

const initialDoc: MigraDoc = (() => {
  if (props.initialDoc && isDoc(props.initialDoc)) return props.initialDoc;
  return createEmptyDoc();
})();

const doc = ref<MigraDoc>(initialDoc);
const legacyElements = computed<EditorElement[]>(() => docToLegacy(doc.value) as unknown as EditorElement[]);

const widgets = ref<WidgetDefinition[]>([]);
const categories = ref<Record<string, CategoryDefinition>>({});

const selectedElementId = ref<string | null>(doc.value.rootId);
const selectedElementIds = ref<Set<string>>(new Set([doc.value.rootId]));
const selectionAnchorId = ref<string>(doc.value.rootId);

type InlineEditState = (InlineEditSpec & { nodeId: string }) | null;
const inlineEdit = ref<InlineEditState>(null);
const selectedNode = computed<DocNode | null>(() => {
  const id = selectedElementId.value;
  if (!id) return null;
  return doc.value.nodes[id] || null;
});
const selectedWidgetDef = computed(() => {
  const node = selectedNode.value;
  if (!node) return null;
  return getWidgetDefinition(node.type) || null;
});

// No WP globals — site/page context comes from props
const previewUrl = '/api/v1/preview';
const brandLogoUrl = computed(() => siteBranding.value?.siteIconUrl || '');
const canManageBranding = computed(() => siteBranding.value?.canManage ?? false);

  function clamp(n: number, min: number, max: number) {
    return Math.max(min, Math.min(max, n));
  }

  function startResize(e: PointerEvent) {
    isResizing.value = true;
    const startX = e.clientX;
    const startW = Number(leftWidth.value) || 288;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      leftWidth.value = clamp(startW + dx, 260, 520);
    };

    const up = () => {
      isResizing.value = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

		function normalizeSettingsEnv(s: any): SettingsEnvelope {
		  const base = structuredClone(DEFAULT_SETTINGS_ENVELOPE);
		  if (!s || typeof s !== 'object') return base;
		  const globalTheme = ensureReadableThemeTokens({ ...base.global.theme, ...(s.global?.theme || {}) });
		  const effectiveTheme = ensureReadableThemeTokens({ ...base.effective.theme, ...(s.effective?.theme || globalTheme) });
		  if (!globalTheme.accent2) globalTheme.accent2 = DEFAULT_THEME.accent2;
		  if (!effectiveTheme.accent2) effectiveTheme.accent2 = globalTheme.accent2;
		  return {
		    ...base,
		    ...s,
		    global: {
		      ...base.global,
		      ...(s.global || {}),
		      keybindings: { ...base.global.keybindings, ...(s.global?.keybindings || {}) },
		      theme: globalTheme,
		    },
		    user: {
		      ...base.user,
		      ...(s.user || {}),
		      keybindingsOverride: { ...(s.user?.keybindingsOverride || {}) },
		    },
		    effective: {
		      ...base.effective,
		      ...(s.effective || {}),
		      keybindings: { ...base.effective.keybindings, ...(s.effective?.keybindings || {}) },
		      theme: effectiveTheme,
		    },
		    canEditGlobal: Boolean(s.canEditGlobal),
		  };
		}

		const settingsEnv = ref<SettingsEnvelope>(normalizeSettingsEnv({}));
		const themePreview = ref<ThemeTokens | null>(null);
		const themeActive = computed<ThemeTokens>(() => themePreview.value || settingsEnv.value.effective.theme || DEFAULT_THEME);
		const themeVars = computed(() => toCssVars(computeTheme(themeActive.value)));

    onMounted(() => {
      initSiteBranding(
        { siteId: props.siteId },
        {},
      );
      loadSiteBranding().catch(() => {});
    });

watch(activeTab, (next) => {
  if (next !== 'prefs') themePreview.value = null;
});

	const SHORTCUTS_DISMISSED_LOCAL_KEY = 'migra_builder_shortcuts_dismissed_local_v1';
	const showShortcutsHint = ref(false);
		const paletteOpen = ref(false);
		const styleClipboard = ref<Record<string, any> | null>(null);

		function handlePreviewTheme(next: ThemeTokens | null) {
		  themePreview.value = next;
		}

	function isLocallyDismissed(): boolean {
	  try {
	    return window.localStorage.getItem(SHORTCUTS_DISMISSED_LOCAL_KEY) === '1';
	  } catch {
	    return false;
	  }
	}

	function dismissHintLocal() {
	  try {
	    window.localStorage.setItem(SHORTCUTS_DISMISSED_LOCAL_KEY, '1');
	  } catch {
	    // ignore
	  }
	  showShortcutsHint.value = false;
	}

	function showHintAgain() {
	  try {
	    window.localStorage.removeItem(SHORTCUTS_DISMISSED_LOCAL_KEY);
	  } catch {
	    // ignore
	  }
	  showShortcutsHint.value = true;
	}

		function handleSettingsUpdate(next: SettingsEnvelope) {
		  settingsEnv.value = normalizeSettingsEnv(next);
		  themePreview.value = null;
		  if (!settingsEnv.value?.effective?.showShortcutsHint) {
		    showShortcutsHint.value = false;
		  }
		}

const saving = ref(false);
const statusText = ref('Ready');

type HistoryEntry = { label: string; snapshot: MigraDoc; ts: number };
const history = ref<HistoryEntry[]>([{ label: 'Start', snapshot: structuredClone(doc.value), ts: Date.now() }]);
const historyIndex = ref(0);
const isRestoring = ref(false);
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < history.value.length - 1);

function pushHistory(label: string) {
  const snapshot = structuredClone(doc.value);
  const next = history.value.slice(0, historyIndex.value + 1);
  next.push({ label, snapshot, ts: Date.now() });
  history.value = next;
  historyIndex.value = next.length - 1;
}

let pendingHistoryTimer: number | null = null;
let pendingHistoryLabel: string | null = null;

function clearPendingHistory() {
  if (pendingHistoryTimer) window.clearTimeout(pendingHistoryTimer);
  pendingHistoryTimer = null;
  pendingHistoryLabel = null;
}

function flushPendingHistory() {
  if (!pendingHistoryLabel) return;
  clearPendingHistory();
  pushHistory(pendingHistoryLabel);
}

function commitDoc(next: MigraDoc, label: string, opts?: { debounceMs?: number }) {
  if (isRestoring.value) return;

  // If we are doing an explicit action, finalize any pending debounced edit first so undo is sane.
  if (!opts?.debounceMs) flushPendingHistory();

  doc.value = next;
  normalizeSelection(next);
  statusText.value = 'Unsaved changes';

  const ms = opts?.debounceMs ?? 0;
  if (ms > 0) {
    // Any new change invalidates redo immediately, even if we debounce the snapshot push.
    history.value = history.value.slice(0, historyIndex.value + 1);
    pendingHistoryLabel = label;
    if (pendingHistoryTimer) window.clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = window.setTimeout(() => {
      pendingHistoryTimer = null;
      const l = pendingHistoryLabel;
      pendingHistoryLabel = null;
      if (l) pushHistory(l);
    }, ms);
    return;
  }

  pushHistory(label);
}

function selectionAsArray(): string[] {
  return Array.from(selectedElementIds.value);
}

function nodePropBool(nodeId: string, keys: string[]): boolean {
  const n = doc.value.nodes[nodeId];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  for (const k of keys) {
    if (p[k] === true) return true;
  }
  return false;
}

function isNodeLockedOwn(nodeId: string): boolean {
  return nodePropBool(nodeId, ['locked', 'isLocked', 'mgLocked']);
}

function findLockingAncestorId(nodeId: string): string | null {
  if (!doc.value.nodes[nodeId]) return null;
  if (isNodeLockedOwn(nodeId)) return nodeId;

  let cur = nodeId;
  while (true) {
    const parentId = findParentId(doc.value, cur);
    if (!parentId) return null;
    if (isNodeLockedOwn(parentId)) return parentId;
    cur = parentId;
  }
}

function getLockState(nodeId: string): 'none' | 'own' | 'inherited' {
  if (!doc.value.nodes[nodeId]) return 'none';
  if (isNodeLockedOwn(nodeId)) return 'own';
  return findLockingAncestorId(nodeId) ? 'inherited' : 'none';
}

// Effective lock = own OR any ancestor own lock.
function isNodeLocked(nodeId: string): boolean {
  return Boolean(findLockingAncestorId(nodeId));
}

function isNodeHidden(nodeId: string): boolean {
  const n = doc.value.nodes[nodeId];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  if (p.hidden === true || p.isHidden === true || p.mgHidden === true) return true;
  const vis = String(p.visibility ?? '').toLowerCase();
  if (vis === 'hidden') return true;
  const disp = String(p.display ?? '').toLowerCase();
  if (disp === 'none') return true;
  return false;
}

function isNodeMovable(nodeId: string): boolean {
  if (!nodeId) return false;
  if (nodeId === doc.value.rootId) return false;
  if (!doc.value.nodes[nodeId]) return false;
  if (isNodeLocked(nodeId)) return false;
  if (isNodeHidden(nodeId)) return false;
  return true;
}

function isDropTargetAllowed(parentId: string): boolean {
  if (!parentId) return false;
  if (parentId === doc.value.rootId) return true;
  if (!doc.value.nodes[parentId]) return false;
  if (isNodeLocked(parentId)) return false;
  if (isNodeHidden(parentId)) return false;
  return true;
}

function selectionIdsExcludingRoot(): string[] {
  return selectionAsArray().filter((id) => id && id !== doc.value.rootId && Boolean(doc.value.nodes[id]));
}

function patchNodesProps(nodeIds: string[], patch: Record<string, any>, label: string) {
  const ids = nodeIds.filter((id) => id && id !== doc.value.rootId && Boolean(doc.value.nodes[id]));
  if (ids.length === 0) return;

  const next = structuredClone(doc.value) as MigraDoc;
  for (const id of ids) {
    next.nodes[id].props = { ...(next.nodes[id].props ?? {}), ...(patch ?? {}) };
  }
  commitDoc(next, label);
}

function handleToggleLockSelection(focusId?: string | null) {
  const focus = String(focusId || '').trim();
  if (focus && doc.value.nodes[focus] && !selectedElementIds.value.has(focus)) {
    selectSingle(focus);
  }

  const ids = selectionIdsExcludingRoot();
  if (ids.length === 0) return;

  const allLockedEffective = ids.every((id) => isNodeLocked(id));

  // Enterprise: unlocking only removes OWN locks. Inherited locks require unlocking the parent.
  if (allLockedEffective) {
    const ownLocked = ids.filter((id) => getLockState(id) === 'own');
    if (ownLocked.length === 0) return;
    patchNodesProps(ownLocked, { locked: false, isLocked: false, mgLocked: false }, 'Unlock selection');
    return;
  }

  patchNodesProps(ids, { locked: true, isLocked: true, mgLocked: true }, 'Lock selection');
}

function handleToggleHiddenSelection(focusId?: string | null) {
  const focus = String(focusId || '').trim();
  if (focus && doc.value.nodes[focus] && !selectedElementIds.value.has(focus)) {
    selectSingle(focus);
  }

  const ids = selectionIdsExcludingRoot();
  if (ids.length === 0) return;

  const allHidden = ids.every((id) => isNodeHidden(id));
  patchNodesProps(
    ids,
    {
      hidden: !allHidden,
      isHidden: !allHidden,
      mgHidden: !allHidden,
      ...(allHidden ? { visibility: undefined, display: undefined } : {}),
    } as any,
    allHidden ? 'Unhide selection' : 'Hide selection'
  );
}

function isUnlockOrUnhidePatch(patch: Record<string, any>): boolean {
  const keys = new Set(['locked', 'isLocked', 'mgLocked', 'hidden', 'isHidden', 'mgHidden', 'visibility', 'display']);
  for (const k of Object.keys(patch ?? {})) {
    if (keys.has(k)) return true;
  }
  return false;
}

function normalizeSelection(nextDoc: MigraDoc) {
  const valid = new Set<string>();
  for (const id of selectedElementIds.value) {
    if (nextDoc.nodes[id]) valid.add(id);
  }
  if (valid.size === 0) {
    valid.add(nextDoc.rootId);
    selectedElementId.value = nextDoc.rootId;
    selectionAnchorId.value = nextDoc.rootId;
  } else if (selectedElementId.value && !nextDoc.nodes[selectedElementId.value]) {
    selectedElementId.value = Array.from(valid)[0] || nextDoc.rootId;
  }
  selectedElementIds.value = valid;
}

function selectRoot(additive: boolean) {
  inlineEdit.value = null;
  if (additive) return;
  selectedElementIds.value = new Set([doc.value.rootId]);
  selectedElementId.value = doc.value.rootId;
  selectionAnchorId.value = doc.value.rootId;
}

function setPrimary(id: string) {
  if (!doc.value.nodes[id]) return;
  selectedElementId.value = id;
  selectionAnchorId.value = id;
}

function selectSingle(id: string) {
  inlineEdit.value = null;
  if (!doc.value.nodes[id]) return;
  selectedElementIds.value = new Set([id]);
  selectedElementId.value = id;
  selectionAnchorId.value = id;
}

function toggleSelect(id: string) {
  inlineEdit.value = null;
  if (!doc.value.nodes[id]) return;
  const next = new Set(selectedElementIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);

  if (next.size === 0) next.add(doc.value.rootId);
  // When selecting any real node, remove root.
  if (next.size > 1) next.delete(doc.value.rootId);

  selectedElementIds.value = next;
  selectedElementId.value = id;
  selectionAnchorId.value = id;
}

function rangeSelect(id: string) {
  inlineEdit.value = null;
  if (!doc.value.nodes[id]) return;

  const anchor = selectionAnchorId.value;
  if (!doc.value.nodes[anchor]) {
    selectSingle(id);
    return;
  }

  const parentA = findParentId(doc.value, anchor);
  const parentB = findParentId(doc.value, id);
  if (!parentA || !parentB || parentA !== parentB) {
    selectSingle(id);
    return;
  }

  const siblings = doc.value.nodes[parentA]?.children ?? [];
  const a = siblings.indexOf(anchor);
  const b = siblings.indexOf(id);
  if (a < 0 || b < 0) {
    selectSingle(id);
    return;
  }

  const [lo, hi] = a <= b ? [a, b] : [b, a];
  const slice = siblings.slice(lo, hi + 1);
  selectedElementIds.value = new Set(slice);
  selectedElementId.value = id;
}

function handleSelectRequest(payload: { id: string; additive: boolean; range: boolean }, opts?: { source?: 'canvas' | 'navigator' }) {
  const id = String(payload?.id || '').trim();
  if (!id) return;

  if (id === doc.value.rootId) {
    selectRoot(payload.additive);
  } else if (payload.range) {
    rangeSelect(id);
  } else if (payload.additive) {
    toggleSelect(id);
  } else if (selectedElementIds.value.has(id)) {
    setPrimary(id);
  } else {
    selectSingle(id);
  }

  // Canvas selection should not forcibly yank the user away from where they are working.
  if (opts?.source !== 'canvas') {
    activeTab.value = 'settings';
  }

  if (!isLocallyDismissed() && settingsEnv.value?.effective?.showShortcutsHint) {
    showShortcutsHint.value = true;
  }
}

function handleSetSelection(payload: { ids: string[]; additive: boolean }) {
  inlineEdit.value = null;
  const ids = (payload?.ids || []).filter((id) => id && doc.value.nodes[id] && id !== doc.value.rootId);
  if (ids.length === 0) {
    selectRoot(payload?.additive ?? false);
    return;
  }
  if (payload.additive) {
    const next = new Set(selectedElementIds.value);
    next.delete(doc.value.rootId);
    for (const id of ids) next.add(id);
    selectedElementIds.value = next;
  } else {
    selectedElementIds.value = new Set(ids);
  }
  selectedElementId.value = ids[ids.length - 1];
  selectionAnchorId.value = ids[0];
}

function selectionIsMulti(): boolean {
  const ids = selectionAsArray().filter((id) => id !== doc.value.rootId);
  return ids.length > 1;
}

function getSelectedSameParent(): { ok: boolean; parentId: string | null; ids: string[] } {
  const ids = selectionAsArray().filter((id) => id && id !== doc.value.rootId);
  if (ids.length <= 1) return { ok: false, parentId: null, ids };
  const p0 = findParentId(doc.value, ids[0]);
  if (!p0) return { ok: false, parentId: null, ids };
  for (const id of ids) {
    if (findParentId(doc.value, id) !== p0) return { ok: false, parentId: null, ids };
  }
  return { ok: true, parentId: p0, ids };
}

function handleMoveSelectionRelative(delta: -1 | 1, focusId?: string) {
  const focus = String(focusId || selectedElementId.value || '').trim();
  if (!focus || focus === doc.value.rootId) return;
  if (!selectedElementIds.value.has(focus)) {
    // Toolbar clicks don't bubble to node selection; treat as single-node action.
    selectSingle(focus);
    handleMoveRelativeById(focus, delta);
    return;
  }

  const g = getSelectedSameParent();
  if (!g.ok || !g.parentId) {
    handleMoveRelativeById(focus, delta);
    return;
  }

  // Enterprise: locked/hidden nodes (including inherited lock) cannot be reordered.
  if (!g.ids.every((id) => isNodeMovable(id))) return;
  if (!isDropTargetAllowed(g.parentId)) return;

  const parentId = g.parentId;
  const original = doc.value.nodes[parentId]?.children ?? [];
  const set = new Set(g.ids);

  const firstIndex = original.findIndex((id) => set.has(id));
  let lastIndex = -1;
  for (let i = 0; i < original.length; i++) if (set.has(original[i])) lastIndex = i;
  if (firstIndex < 0 || lastIndex < 0) return;

  let pivotId: string | null = null;
  if (delta < 0) {
    for (let i = firstIndex - 1; i >= 0; i--) {
      if (!set.has(original[i])) { pivotId = original[i]; break; }
    }
    if (!pivotId) return;
  } else {
    for (let i = lastIndex + 1; i < original.length; i++) {
      if (!set.has(original[i])) { pivotId = original[i]; break; }
    }
    if (!pivotId) return;
  }

  const moved = original.filter((id) => set.has(id));
  const remaining = original.filter((id) => !set.has(id));
  const pivotIndex = remaining.indexOf(pivotId);
  if (pivotIndex < 0) return;

  const insertAt = delta < 0 ? pivotIndex : pivotIndex + 1;
  remaining.splice(insertAt, 0, ...moved);

  const next = structuredClone(doc.value) as MigraDoc;
  next.nodes[parentId].children = remaining;
  commitDoc(next, 'Move selection');
  setPrimary(focus);
}

function handleIndentSelection(focusId?: string) {
  const focus = String(focusId || selectedElementId.value || '').trim();
  if (!focus || focus === doc.value.rootId) return;
  if (!selectedElementIds.value.has(focus)) {
    selectSingle(focus);
    handleIndentById(focus);
    return;
  }

  const g = getSelectedSameParent();
  const cur = doc.value;

  if (g.ok && g.parentId) {
    if (!g.ids.every((id) => isNodeMovable(id))) return;
    const parentId = g.parentId;
    const siblings = cur.nodes[parentId]?.children ?? [];
    const set = new Set(g.ids);
    const firstIndex = siblings.findIndex((id) => set.has(id));
    if (firstIndex <= 0) return;
    const prevId = siblings[firstIndex - 1];
    const prev = cur.nodes[prevId];
    if (!prev || !canHaveChildrenType(prev.type)) return;
    if (!isDropTargetAllowed(prevId)) return;

    const next = structuredClone(cur) as MigraDoc;
    next.nodes[parentId].children = (next.nodes[parentId].children ?? []).filter((id) => !set.has(id));
    next.nodes[prevId].children = [...(next.nodes[prevId].children ?? []), ...g.ids];
    commitDoc(next, 'Indent selection');
    setPrimary(focus);
    return;
  }

  handleIndentById(focus);
}

function handleOutdentSelection(focusId?: string) {
  const focus = String(focusId || selectedElementId.value || '').trim();
  if (!focus || focus === doc.value.rootId) return;
  if (!selectedElementIds.value.has(focus)) {
    selectSingle(focus);
    handleOutdentById(focus);
    return;
  }

  const g = getSelectedSameParent();
  const cur = doc.value;
  if (g.ok && g.parentId) {
    if (!g.ids.every((id) => isNodeMovable(id))) return;
    const parentId = g.parentId;
    if (parentId === cur.rootId) return;
    const grandId = findParentId(cur, parentId);
    if (!grandId) return;
    if (!isDropTargetAllowed(grandId)) return;
    const gKids = cur.nodes[grandId]?.children ?? [];
    const parentIndex = gKids.indexOf(parentId);
    if (parentIndex < 0) return;

    const set = new Set(g.ids);
    const next = structuredClone(cur) as MigraDoc;
    next.nodes[parentId].children = (next.nodes[parentId].children ?? []).filter((id) => !set.has(id));
    const grandChildren = next.nodes[grandId].children ?? [];
    grandChildren.splice(parentIndex + 1, 0, ...g.ids);
    next.nodes[grandId].children = grandChildren;
    commitDoc(next, 'Outdent selection');
    setPrimary(focus);
    return;
  }

  handleOutdentById(focus);
}

function selectedRootsForDelete(ids: string[]): string[] {
  const set = new Set(ids);
  const roots: string[] = [];
  for (const id of ids) {
    if (!id || id === doc.value.rootId) continue;
    let cur: string | null = id;
    let skip = false;
    while (cur) {
      const pid = findParentId(doc.value, cur);
      if (!pid) break;
      if (set.has(pid)) { skip = true; break; }
      cur = pid;
    }
    if (!skip) roots.push(id);
  }
  return roots;
}

function handleDeleteSelection(focusId?: string) {
  const ids = selectionAsArray().filter((id) => id && id !== doc.value.rootId);
  const focus = String(focusId || selectedElementId.value || '').trim();

  if (ids.length <= 1) {
    handleDeleteNodeById(focus);
    return;
  }
  if (focus && !selectedElementIds.value.has(focus)) {
    handleDeleteNodeById(focus);
    return;
  }

  const roots = selectedRootsForDelete(ids);
  // Enterprise: don't partially delete when selection includes locked/hidden nodes.
  if (roots.some((id) => isNodeLocked(id) || isNodeHidden(id))) return;
  let next = doc.value;
  for (const id of roots) next = deleteNode(next, id);
  commitDoc(next, 'Delete selection');
  selectRoot(false);
  activeTab.value = 'navigator';
}

function handleDuplicateSelection(focusId?: string) {
  const focus = String(focusId || selectedElementId.value || '').trim();
  if (!focus || focus === doc.value.rootId) return;
  if (focus && !selectedElementIds.value.has(focus)) {
    handleDuplicateNodeById(focus);
    return;
  }

  if (!selectionIsMulti()) {
    handleDuplicateNodeById(focus);
    return;
  }

  const g = getSelectedSameParent();
  if (!g.ok || !g.parentId) {
    handleDuplicateNodeById(focus);
    return;
  }

  // Enterprise: don't partially duplicate when selection includes locked/hidden nodes.
  if (g.ids.some((id) => isNodeLocked(id) || isNodeHidden(id))) return;

  let nextDoc = doc.value;
  const newIds: string[] = [];
  for (const id of g.ids) {
    const res = duplicateNode(nextDoc, id);
    nextDoc = res.doc;
    if (res.id) newIds.push(res.id);
  }

  commitDoc(nextDoc, 'Duplicate selection');
  if (newIds.length) {
    selectedElementIds.value = new Set(newIds);
    selectedElementId.value = newIds[newIds.length - 1];
    selectionAnchorId.value = newIds[0];
    activeTab.value = 'settings';
  }
}

function handleInlineStart(id: string) {
  const node = doc.value.nodes[id];
  if (!node) return;
  if (isNodeLocked(id) || isNodeHidden(id)) return;
  const spec = resolveInlineEditSpec(node.type, node.props || {});
  if (!spec) return;
  inlineEdit.value = { nodeId: id, ...spec };
  handleSelectRequest({ id, additive: false, range: false }, { source: 'canvas' });
}

function handleInlineCommit(payload: { id: string; key: string; value: string }) {
  const id = String(payload?.id || '').trim();
  const key = String(payload?.key || '').trim();
  if (!id || !key) return;
  inlineEdit.value = null;
  if (isNodeLocked(id) || isNodeHidden(id)) return;
  const patch: Record<string, any> = { [key]: payload.value };
  commitDoc(patchNodeProps(doc.value, id, patch), 'Inline edit');
}

function handleInlineCancel() {
  inlineEdit.value = null;
}

function canHaveChildrenType(type: string): boolean {
  return type === 'root' || type === 'section' || type === 'container';
}

function handleAddWidgetAt(payload: { type: string; parentId: string; index: number }) {
  const type = String(payload?.type || '').trim();
  const parentId = String(payload?.parentId || '').trim();
  const index = Number(payload?.index);
  if (!type || !parentId || Number.isNaN(index)) return;
  if (!isDropTargetAllowed(parentId)) return;

  const def = getWidgetDefinition(type);
  const defaults = def?.defaults || {};

  const next = structuredClone(doc.value) as MigraDoc;
  const parent = next.nodes[parentId];
  if (!parent) return;
  if (!canHaveChildrenType(parent.type)) return;

  const id = makeId('n');
  next.nodes[id] = { id, type, props: structuredClone(defaults), children: [] } as any;

  parent.children = parent.children ?? [];
  const i = Math.max(0, Math.min(parent.children.length, index));
  parent.children.splice(i, 0, id);

  commitDoc(next, `Add ${def?.title || type}`);
  selectSingle(id);
  activeTab.value = 'settings';
}

function handleDeleteNodeById(id: string) {
  const nodeId = String(id || '').trim();
  if (!nodeId || nodeId === doc.value.rootId) return;
  if (isNodeLocked(nodeId) || isNodeHidden(nodeId)) return;
  const parentId = findParentId(doc.value, nodeId);
  commitDoc(deleteNode(doc.value, nodeId), 'Delete');
  selectSingle(parentId || doc.value.rootId);
  activeTab.value = 'navigator';
}

function handleDuplicateNodeById(id: string) {
  const nodeId = String(id || '').trim();
  if (!nodeId || nodeId === doc.value.rootId) return;
  if (isNodeLocked(nodeId) || isNodeHidden(nodeId)) return;
  const res = duplicateNode(doc.value, nodeId);
  if (!res.id) return;
  commitDoc(res.doc, 'Duplicate');
  selectSingle(res.id);
  activeTab.value = 'settings';
}

function handleMoveRelativeById(id: string, delta: -1 | 1) {
  const nodeId = String(id || '').trim();
  if (!nodeId || nodeId === doc.value.rootId) return;

  const parentId = findParentId(doc.value, nodeId);
  if (!parentId) return;
  const siblings = doc.value.nodes[parentId]?.children ?? [];
  const idx = siblings.indexOf(nodeId);
  if (idx < 0) return;
  const nextIdx = idx + delta;
  if (nextIdx < 0 || nextIdx >= siblings.length) return;

  const insertIndex = delta < 0 ? nextIdx : nextIdx + 1;
  handleMoveNode({ activeId: nodeId, parentId, index: insertIndex });
}

function handleIndentById(id: string) {
  const nodeId = String(id || '').trim();
  if (!nodeId || nodeId === doc.value.rootId) return;

  const parentId = findParentId(doc.value, nodeId);
  if (!parentId) return;
  const siblings = doc.value.nodes[parentId]?.children ?? [];
  const idx = siblings.indexOf(nodeId);
  if (idx <= 0) return;

  const prevSiblingId = siblings[idx - 1];
  const prev = doc.value.nodes[prevSiblingId];
  if (!prev || !canHaveChildrenType(prev.type)) return;

  handleMoveNode({ activeId: nodeId, parentId: prevSiblingId, index: (prev.children ?? []).length });
}

function handleOutdentById(id: string) {
  const nodeId = String(id || '').trim();
  if (!nodeId || nodeId === doc.value.rootId) return;

  const parentId = findParentId(doc.value, nodeId);
  if (!parentId || parentId === doc.value.rootId) return;
  const grandParentId = findParentId(doc.value, parentId) || doc.value.rootId;

  const grandChildren = doc.value.nodes[grandParentId]?.children ?? [];
  const parentIndex = grandChildren.indexOf(parentId);
  if (parentIndex < 0) return;

  handleMoveNode({ activeId: nodeId, parentId: grandParentId, index: parentIndex + 1 });
}

function handleAddWidget(widget: WidgetDefinition) {
  const def = getWidgetDefinition(widget.name);
  const defaults = def?.defaults || {};

  const selectedId = selectedElementId.value;
  const selected = selectedId ? doc.value.nodes[selectedId] : null;

  if (selectedId && selected && canHaveChildrenType(selected.type) && isDropTargetAllowed(selectedId)) {
    handleAddWidgetAt({ type: widget.name, parentId: selectedId, index: (selected.children ?? []).length });
    return;
  }

  if (selectedId) {
    const parentId = findParentId(doc.value, selectedId) || doc.value.rootId;
    const siblings = doc.value.nodes[parentId]?.children ?? [];
    const idx = siblings.indexOf(selectedId);
    handleAddWidgetAt({ type: widget.name, parentId, index: idx >= 0 ? idx + 1 : siblings.length });
    return;
  }

  const { doc: next, id } = addNode(doc.value, doc.value.rootId, widget.name, defaults);
  commitDoc(next, `Add ${widget.title}`);
  if (id) selectSingle(id);
  activeTab.value = 'settings';
}

		function handleSelectElement(id: string) {
	  handleSelectRequest({ id, additive: false, range: false }, { source: 'navigator' });
	}

function handlePatchNode(payload: { id: string; patch: Record<string, any> }) {
  const id = String(payload?.id || '').trim();
  if (!id) return;
  const patch = payload?.patch || {};

  if ((isNodeLocked(id) || isNodeHidden(id)) && !isUnlockOrUnhidePatch(patch)) {
    // Enterprise: locked/hidden nodes are not editable via inspector.
    return;
  }

  const next = patchNodeProps(doc.value, id, patch);
  commitDoc(next, 'Edit', { debounceMs: 450 });
}

function handleDeleteSelected() {
  handleDeleteSelection(selectedElementId.value || undefined);
}

function handleDuplicateSelected() {
  handleDuplicateSelection(selectedElementId.value || undefined);
}

function handleCopyStyles() {
  const node = selectedNode.value;
  if (!node) return;
  styleClipboard.value = structuredClone(node.props || {});
}

function handlePasteStyles() {
  const node = selectedNode.value;
  if (!node || !styleClipboard.value) return;
  commitDoc(patchNodeProps(doc.value, node.id, styleClipboard.value), 'Paste styles');
}

function handleWrapContainer() {
  const id = selectedElementId.value;
  if (!id) return;
  const def = getWidgetDefinition('container');
  const res = wrapNode(doc.value, id, 'container', def?.defaults || {});
  if (!res.id) return;
  commitDoc(res.doc, 'Wrap in container');
  selectSingle(res.id);
  activeTab.value = 'navigator';
}

function handleUnwrap() {
  const id = selectedElementId.value;
  if (!id) return;
  const res = unwrapNode(doc.value, id);
  if (!res.id) return;
  commitDoc(res.doc, 'Unwrap');
  selectSingle(res.id);
  activeTab.value = 'navigator';
}

function handleMoveNode(payload: { activeId: string; parentId: string; index: number }) {
  if (!payload?.activeId || payload.activeId === doc.value.rootId) return;
  if (!isNodeMovable(payload.activeId)) return;
  if (!isDropTargetAllowed(payload.parentId)) return;
  commitDoc(moveNode(doc.value, payload.activeId, payload.parentId, payload.index), 'Move');
  if (selectedElementIds.value.has(payload.activeId)) setPrimary(payload.activeId);
  else selectSingle(payload.activeId);
  activeTab.value = 'navigator';
}

function handleMoveGroup(payload: { activeId: string; groupIds: string[]; parentId: string; index: number }) {
  const activeId = String(payload?.activeId || '').trim();
  const targetParentId = String(payload?.parentId || '').trim();
  const targetIndex = Number(payload?.index);
  const rawGroupIds = Array.isArray(payload?.groupIds) ? payload.groupIds.map((x) => String(x || '').trim()) : [];

  if (!activeId || activeId === doc.value.rootId) return;
  if (!targetParentId || !doc.value.nodes[targetParentId] || Number.isNaN(targetIndex)) return;
  if (!isDropTargetAllowed(targetParentId)) return;

  const groupIds = rawGroupIds.filter((id) => id && id !== doc.value.rootId && doc.value.nodes[id]);
  if (groupIds.length <= 1) {
    handleMoveNode({ activeId, parentId: targetParentId, index: targetIndex });
    return;
  }

  // Enterprise: group move only if all nodes are movable.
  if (!groupIds.every((id) => isNodeMovable(id))) return;

  const fromParentId = findParentId(doc.value, groupIds[0]);
  if (!fromParentId) return;
  for (const id of groupIds) {
    if (findParentId(doc.value, id) !== fromParentId) return;
  }

  // Prevent dropping into a descendant of any moved node.
  for (const id of groupIds) {
    if (isDescendant(doc.value, id, targetParentId)) return;
  }

  const next = structuredClone(doc.value) as MigraDoc;
  const fromChildren = next.nodes[fromParentId]?.children ?? [];
  const set = new Set(groupIds);
  next.nodes[fromParentId].children = fromChildren.filter((id) => !set.has(id));

  const targetChildren = next.nodes[targetParentId]?.children ?? [];

  let idx = Math.max(0, Math.floor(targetIndex));
  if (fromParentId === targetParentId) {
    const original = doc.value.nodes[fromParentId]?.children ?? [];
    const removedBefore = original.slice(0, idx).filter((id) => set.has(id)).length;
    idx = Math.max(0, idx - removedBefore);
  }
  idx = Math.min(idx, targetChildren.length);

  next.nodes[targetParentId].children = [...targetChildren.slice(0, idx), ...groupIds, ...targetChildren.slice(idx)];

  commitDoc(next, 'Move selection');
  selectedElementIds.value = new Set(groupIds);
  setPrimary(activeId);
  activeTab.value = 'navigator';
}

async function saveDraft() {
  if (!props.siteId || !props.pageId) {
    statusText.value = 'Missing site/page context';
    return;
  }
  saving.value = true;
  statusText.value = 'Saving…';
  try {
    const { savePage } = await import('../api/client');
    await savePage(props.siteId, props.pageId, doc.value, 'draft');
    statusText.value = 'Saved';
  } catch (err: unknown) {
    statusText.value = err instanceof Error ? err.message : 'Save failed';
  } finally {
    saving.value = false;
  }
}

function undo() {
  if (!canUndo.value) return;
  flushPendingHistory();
  if (!canUndo.value) return;
  isRestoring.value = true;
  historyIndex.value -= 1;
  doc.value = structuredClone(history.value[historyIndex.value].snapshot);
  inlineEdit.value = null;
  normalizeSelection(doc.value);
  window.setTimeout(() => (isRestoring.value = false), 0);
  statusText.value = 'Undone';
}

function redo() {
  if (!canRedo.value) return;
  flushPendingHistory();
  if (!canRedo.value) return;
  isRestoring.value = true;
  historyIndex.value += 1;
  doc.value = structuredClone(history.value[historyIndex.value].snapshot);
  inlineEdit.value = null;
  normalizeSelection(doc.value);
  window.setTimeout(() => (isRestoring.value = false), 0);
  statusText.value = 'Redone';
}

function jumpToHistory(index: number) {
  if (index < 0 || index >= history.value.length) return;
  flushPendingHistory();
  if (index < 0 || index >= history.value.length) return;
  isRestoring.value = true;
  historyIndex.value = index;
  doc.value = structuredClone(history.value[historyIndex.value].snapshot);
  inlineEdit.value = null;
  normalizeSelection(doc.value);
  window.setTimeout(() => (isRestoring.value = false), 0);
  statusText.value = 'Restored';
}

function handleKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  const tag = String(target?.tagName || '').toLowerCase();
  const isTyping =
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    Boolean(target?.isContentEditable);

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    paletteOpen.value = true;
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    saveDraft();
    return;
  }

  if (isTyping) return;

  const selected = selectedElementId.value;

  if (event.altKey && event.key === 'ArrowUp') {
    if (selected) {
      event.preventDefault();
      handleMoveSelectionRelative(-1, selected);
    }
    return;
  }

  if (event.altKey && event.key === 'ArrowDown') {
    if (selected) {
      event.preventDefault();
      handleMoveSelectionRelative(1, selected);
    }
    return;
  }

  if (event.key === 'Tab' && !event.shiftKey) {
    if (selected) {
      event.preventDefault();
      handleIndentSelection(selected);
    }
    return;
  }

  if (event.key === 'Tab' && event.shiftKey) {
    if (selected) {
      event.preventDefault();
      handleOutdentSelection(selected);
    }
    return;
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selected && selected !== doc.value.rootId) {
      event.preventDefault();
      handleDeleteSelection(selected);
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
    if (selected && selected !== doc.value.rootId) {
      event.preventDefault();
      handleDuplicateSelection(selected);
    }
    return;
  }
}

const paletteItems = computed<PaletteItem[]>(() => {
  const base: PaletteItem[] = [
    { id: 'cmd:save', title: 'Save', subtitle: 'Ctrl/Cmd+S', run: () => saveDraft() },
    { id: 'cmd:undo', title: 'Undo', subtitle: 'History', run: () => undo() },
    { id: 'cmd:redo', title: 'Redo', subtitle: 'History', run: () => redo() },
    { id: 'tab:widgets', title: 'Open Widgets', subtitle: 'Left panel', run: () => (activeTab.value = 'widgets') },
    { id: 'tab:settings', title: 'Open Settings', subtitle: 'Left panel', run: () => (activeTab.value = 'settings') },
    { id: 'tab:prefs', title: 'Open Preferences', subtitle: 'Left panel', run: () => (activeTab.value = 'prefs') },
    { id: 'tab:navigator', title: 'Open Navigator', subtitle: 'Left panel', run: () => (activeTab.value = 'navigator') },
    { id: 'tab:history', title: 'Open History', subtitle: 'Left panel', run: () => (activeTab.value = 'history') },
    { id: 'node:duplicate', title: 'Duplicate selected', subtitle: 'Node', run: () => handleDuplicateSelected() },
    { id: 'node:delete', title: 'Delete selected', subtitle: 'Node', run: () => handleDeleteSelected() },
    { id: 'style:copy', title: 'Copy styles', subtitle: 'Node props', run: () => handleCopyStyles() },
    { id: 'style:paste', title: 'Paste styles', subtitle: 'Node props', run: () => handlePasteStyles() },
    { id: 'wrap:container', title: 'Wrap in container', subtitle: 'Layout', run: () => handleWrapContainer() },
    { id: 'wrap:unwrap', title: 'Unwrap (single child)', subtitle: 'Layout', run: () => handleUnwrap() },
  ];

  const widgetItems: PaletteItem[] = widgets.value.map((w: any) => ({
    id: `add:${w.name}`,
    title: `Add ${w.title || w.name}`,
    subtitle: String(w.category || ''),
    run: () => handleAddWidget(w),
  }));

  return [...base, ...widgetItems];
});

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
  clearPendingHistory();
});
</script>
