<template>
  <div
    v-if="node"
    class="migra-node"
    :class="[
      isSelected ? 'migra-node--also-selected' : '',
      n.id === selectedId ? 'migra-node--selected' : '',
      isLocked ? 'migra-node--locked' : '',
      lockState === 'own' ? 'migra-node--locked-own' : '',
      lockState === 'inherited' ? 'migra-node--locked-inherited' : '',
      isHidden ? 'migra-node--hidden' : '',
      isDropTarget ? 'migra-node--drop-target' : '',
      isDropTarget && dndState.position === 'before' ? 'migra-node--drop-before' : '',
      isDropTarget && dndState.position === 'after' ? 'migra-node--drop-after' : '',
      isDropTarget && dndState.position === 'inside' ? 'migra-node--drop-inside' : ''
    ]"
    :data-mg-node-id="n.id"
    :data-mg-parent-id="parentId || ''"
    @mouseenter="hover = true"
    @mouseleave="hover = false"
    @click.stop="onClickNode"
  >
    <div class="migra-node__badge">
      <div class="migra-row" style="gap: var(--s-3);">
        <span class="migra-node__type">{{ n.type }}</span>
        <span class="migra-node__id">{{ n.id }}</span>
      </div>
      <div class="migra-node__actions">
        <InlineNodeToolbar
          v-if="showToolbar"
          :disabled="n.id === doc.rootId"
          :can-move-up="canMoveUp"
          :can-move-down="canMoveDown"
          :can-indent="canIndent"
          :can-outdent="canOutdent"
          :can-toggle-lock-hide="canToggleLockHide"
          :lock-all="lockAll"
          :hide-all="hideAll"
          @move-relative="(delta) => emit('move-relative', { id: n.id, delta })"
          @indent="() => emit('indent', n.id)"
          @outdent="() => emit('outdent', n.id)"
          @toggle-lock="() => emit('toggle-lock', n.id)"
          @toggle-hidden="() => emit('toggle-hidden', n.id)"
          @duplicate="() => emit('duplicate', n.id)"
          @delete="() => emit('delete', n.id)"
        />
      </div>
      <button
        v-if="n.id !== doc.rootId"
        type="button"
        class="migra-btn migra-btn--ghost text-xs migra-drag-handle"
        title="Drag"
        aria-label="Drag"
        data-mg-drag-handle="true"
        :disabled="!isMovable"
        @pointerdown="(e) => (isMovable ? startDrag(n.id, e) : undefined)"
        @click.stop="emit('select', { id: n.id, additive: false, range: false })"
      >
        ⋮⋮
      </button>
    </div>

    <div class="migra-node__content" @dblclick.stop="onDblClick">
      <div v-if="isLocked || isHidden" class="migra-node__overlay" aria-hidden="true">
        <span class="migra-node__overlay-badge">
          <template v-if="isHidden">🙈 Hidden</template>
          <template v-else-if="lockState === 'inherited'">🔐 Locked by parent</template>
          <template v-else>🔒 Locked</template>
        </span>
      </div>

      <InlineEditor
        v-if="isInlineEditing && inlineEdit"
        :kind="inlineEdit.kind"
        :initial-value="inlineInitialValue"
        @commit="(v) => emit('inline-commit', { id: n.id, key: inlineEdit!.key, value: v })"
        @cancel="() => emit('inline-cancel')"
      />
      <WidgetRenderer v-else :node="node">
      <div
        v-if="isContainer"
        class="migra-children migra-children-list"
        :class="isDropList ? 'migra-children-list--drop' : ''"
        :data-mg-parent-id="n.id"
      >
        <InsertBar
          :parent-id="n.id"
          :index="0"
          :widgets="widgets"
          :disabled="n.id !== doc.rootId && (isLocked || isHidden)"
          :label="n.id === doc.rootId ? 'Add here' : 'Add inside'"
          @insert="(type) => emit('add-widget-at', { type, parentId: n.id, index: 0 })"
        />

        <template v-for="(cid, i) in n.children" :key="cid">
          <CanvasNode
            :doc="doc"
            :node-id="cid"
            :parent-id="n.id"
            :selected-id="selectedId"
            :selected-ids="selectedIds"
            :inline-edit="inlineEdit"
            :widgets="widgets"
            @select="(p) => emit('select', p)"
            @move="(p) => emit('move', p)"
            @add-widget-at="(p) => emit('add-widget-at', p)"
            @move-relative="(p) => emit('move-relative', p)"
            @indent="(id) => emit('indent', id)"
            @outdent="(id) => emit('outdent', id)"
            @toggle-lock="(id) => emit('toggle-lock', id)"
            @toggle-hidden="(id) => emit('toggle-hidden', id)"
            @duplicate="(id) => emit('duplicate', id)"
            @delete="(id) => emit('delete', id)"
            @inline-start="(id) => emit('inline-start', id)"
            @inline-commit="(p) => emit('inline-commit', p)"
            @inline-cancel="() => emit('inline-cancel')"
          />

          <InsertBar
            :parent-id="n.id"
            :index="i + 1"
            :widgets="widgets"
            :disabled="n.id !== doc.rootId && (isLocked || isHidden)"
            @insert="(type) => emit('add-widget-at', { type, parentId: n.id, index: i + 1 })"
          />
        </template>

        <div v-if="n.children.length === 0" class="migra-drop-hint">
          Drop here or use “Add”
        </div>
      </div>
      </WidgetRenderer>
    </div>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { computed, inject, ref } from 'vue';
import type { DocNode, MigraDoc, NodeId } from '@/core/document';
import { findParentId } from '@/core/document';
import WidgetRenderer from './WidgetRenderer.vue';
import { BUILDER_DND_KEY } from './useBuilderDnd';
import InsertBar from './InsertBar.vue';
import InlineNodeToolbar from './InlineNodeToolbar.vue';
import InlineEditor from './InlineEditor.vue';
import { resolveInlineEditSpec, type InlineEditSpec } from '@/core/inlineEdit';

const props = defineProps<{
  doc: MigraDoc;
  nodeId: NodeId;
  parentId: NodeId | null;
  selectedId: NodeId | null;
  selectedIds: NodeId[];
  inlineEdit: (InlineEditSpec & { nodeId: NodeId }) | null;
  widgets: Array<{ name: string; title: string; category?: string }>;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { id: NodeId; additive: boolean; range: boolean }): void;
  (e: 'move', payload: { activeId: NodeId; parentId: NodeId; index: number }): void;
  (e: 'add-widget-at', payload: { type: string; parentId: NodeId; index: number }): void;
  (e: 'move-relative', payload: { id: NodeId; delta: -1 | 1 }): void;
  (e: 'indent', id: NodeId): void;
  (e: 'outdent', id: NodeId): void;
  (e: 'toggle-lock', id: NodeId): void;
  (e: 'toggle-hidden', id: NodeId): void;
  (e: 'duplicate', id: NodeId): void;
  (e: 'delete', id: NodeId): void;
  (e: 'inline-start', id: NodeId): void;
  (e: 'inline-commit', payload: { id: NodeId; key: string; value: string }): void;
  (e: 'inline-cancel'): void;
}>();

const node = computed<DocNode | null>(() => props.doc.nodes?.[props.nodeId] ?? null);
// non-null helper used inside v-if="node" blocks; safe because template guards on `node`
const n = computed(() => node.value!);
const hover = ref(false);
const showToolbar = computed(() => hover.value || props.selectedId === props.nodeId);
const selectedIds = computed(() => props.selectedIds || []);
const isSelected = computed(() => selectedIds.value.includes(props.nodeId));

const isContainer = computed(() => {
  const t = node.value?.type;
  return t === 'root' || t === 'section' || t === 'container';
});

const dnd = inject(BUILDER_DND_KEY, null);
const dndState = computed(() => {
  return (
    dnd?.state ?? {
      dragging: false,
      activeId: null,
      groupIds: [],
      overNodeId: null,
      overListParentId: null,
      position: 'none',
      toParentId: null,
      toIndex: -1,
    }
  );
});
const isDropTarget = computed(() => Boolean(dnd?.state.dragging && dnd?.state.overNodeId === props.nodeId));
const isDropList = computed(() => {
  if (!dnd?.state.dragging) return false;
  if (dnd.state.overNodeId) return false;
  return dnd.state.overListParentId === props.nodeId && dnd.state.position === 'inside';
});

function startDrag(id: NodeId, e: PointerEvent) {
  dnd?.startDrag(id, e);
}

const widgets = computed(() => props.widgets || []);

function nodePropBool(id: NodeId, keys: string[]): boolean {
  const n = props.doc.nodes[id];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  for (const k of keys) if (p[k] === true) return true;
  return false;
}

function isNodeLocked(id: NodeId): boolean {
  return Boolean(findLockingAncestorId(id));
}

function isNodeLockedOwn(id: NodeId): boolean {
  return nodePropBool(id, ['locked', 'isLocked', 'mgLocked']);
}

function findLockingAncestorId(nodeId: NodeId): NodeId | null {
  if (!props.doc.nodes[nodeId]) return null;
  if (isNodeLockedOwn(nodeId)) return nodeId;

  let cur: NodeId = nodeId;
  while (true) {
    const pid = findParentId(props.doc, cur);
    if (!pid) return null;
    if (isNodeLockedOwn(pid)) return pid;
    cur = pid;
  }
}

function isNodeHidden(id: NodeId): boolean {
  const n = props.doc.nodes[id];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  if (p.hidden === true || p.isHidden === true || p.mgHidden === true) return true;
  const vis = String(p.visibility ?? '').toLowerCase();
  if (vis === 'hidden') return true;
  const disp = String(p.display ?? '').toLowerCase();
  if (disp === 'none') return true;
  return false;
}

const lockState = computed<'none' | 'own' | 'inherited'>(() => {
  if (!props.doc.nodes[props.nodeId]) return 'none';
  if (isNodeLockedOwn(props.nodeId)) return 'own';
  return findLockingAncestorId(props.nodeId) ? 'inherited' : 'none';
});

const isLocked = computed(() => lockState.value !== 'none');
const isHidden = computed(() => isNodeHidden(props.nodeId));
const isMovable = computed(() => props.nodeId !== props.doc.rootId && !isLocked.value && !isHidden.value);

const selectionIdsForToggles = computed(() => {
  return selectedIds.value.filter((id) => id && id !== props.doc.rootId && Boolean(props.doc.nodes[id]));
});
const canToggleLockHide = computed(() => selectionIdsForToggles.value.length > 0);
const lockAll = computed(() => canToggleLockHide.value && selectionIdsForToggles.value.every((id) => isNodeLocked(id)));
const hideAll = computed(() => canToggleLockHide.value && selectionIdsForToggles.value.every((id) => isNodeHidden(id)));

const resolvedInlineEdit = computed(() => {
  const n = node.value;
  if (!n) return null;
  if (isContainer.value) return null;
  return resolveInlineEditSpec(n.type, (n.props ?? {}) as any);
});

const isInlineEditing = computed(() => Boolean(props.inlineEdit && props.inlineEdit.nodeId === props.nodeId));
const inlineEdit = computed(() => props.inlineEdit);
const inlineInitialValue = computed(() => {
  const n = node.value;
  const ie = props.inlineEdit;
  if (!n || !ie || ie.nodeId !== props.nodeId) return '';
  return String((n.props as any)?.[ie.key] ?? '');
});

function onClickNode(e: MouseEvent) {
  const additive = Boolean(e.metaKey || e.ctrlKey);
  const range = Boolean(e.shiftKey);
  emit('select', { id: props.nodeId, additive, range });
}

function onDblClick() {
  if (!resolvedInlineEdit.value) return;
  if (isLocked.value || isHidden.value) return;
  emit('inline-start', props.nodeId);
}

const groupIds = computed(() => {
  if (!props.parentId) return [];
  const ids = selectedIds.value.filter((id) => id && id !== props.doc.rootId);
  if (ids.length <= 1) return [];
  if (!ids.includes(props.nodeId)) return [];
  for (const id of ids) {
    if (findParentId(props.doc, id) !== props.parentId) return [];
  }
  const set = new Set(ids);
  const siblings = props.doc.nodes[props.parentId]?.children ?? [];
  return siblings.filter((id) => set.has(id));
});

const groupMovable = computed(() => {
  if (groupIds.value.length <= 1) return isMovable.value;
  return groupIds.value.every((id) => props.nodeId !== props.doc.rootId && isNodeMovable(id));
});

function isNodeMovable(id: NodeId): boolean {
  return id !== props.doc.rootId && !isNodeLocked(id) && !isNodeHidden(id);
}

const canMoveUp = computed(() => {
  if (!groupMovable.value) return false;
  if (!props.parentId) return false;
  const siblings = props.doc.nodes[props.parentId]?.children ?? [];
  if (groupIds.value.length > 1) {
    const set = new Set(groupIds.value);
    const firstIndex = siblings.findIndex((id) => set.has(id));
    if (firstIndex <= 0) return false;
    return siblings.slice(0, firstIndex).some((id) => !set.has(id));
  }
  const idx = siblings.indexOf(props.nodeId);
  return idx > 0;
});

const canMoveDown = computed(() => {
  if (!groupMovable.value) return false;
  if (!props.parentId) return false;
  const siblings = props.doc.nodes[props.parentId]?.children ?? [];
  if (groupIds.value.length > 1) {
    const set = new Set(groupIds.value);
    let lastIndex = -1;
    for (let i = 0; i < siblings.length; i++) if (set.has(siblings[i])) lastIndex = i;
    if (lastIndex < 0) return false;
    return siblings.slice(lastIndex + 1).some((id) => !set.has(id));
  }
  const idx = siblings.indexOf(props.nodeId);
  return idx >= 0 && idx < siblings.length - 1;
});

const canIndent = computed(() => {
  if (!groupMovable.value) return false;
  if (!props.parentId) return false;
  const siblings = props.doc.nodes[props.parentId]?.children ?? [];
  if (groupIds.value.length > 1) {
    const set = new Set(groupIds.value);
    const firstIndex = siblings.findIndex((id) => set.has(id));
    if (firstIndex <= 0) return false;
    const prev = props.doc.nodes[siblings[firstIndex - 1]];
    return Boolean(prev && (prev.type === 'section' || prev.type === 'container'));
  }
  const idx = siblings.indexOf(props.nodeId);
  if (idx <= 0) return false;
  const prevId = siblings[idx - 1];
  const prev = props.doc.nodes[prevId];
  return Boolean(prev && (prev.type === 'section' || prev.type === 'container'));
});

const canOutdent = computed(() => {
  if (!groupMovable.value) return false;
  if (!props.parentId) return false;
  if (groupIds.value.length > 1) return props.parentId !== props.doc.rootId;
  return props.parentId !== props.doc.rootId;
});
</script>
