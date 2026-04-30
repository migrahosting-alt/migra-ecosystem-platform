<template>
  <div class="p-4">
    <MigraCard eyebrow="Navigator" title="Layers" :subtitle="`${totalNodes} nodes`">
      <div class="migra-stack">
        <label class="block">
          <span class="sr-only">Search layers</span>
          <input v-model="query" type="text" placeholder="Search layers…" class="migra-input w-full text-sm" />
        </label>

        <div class="migra-row" style="justify-content: space-between;">
          <div class="text-xs migra-muted">
            {{"Selection"}}: {{ selectionIds.length ? selectionIds.length : 0 }}
          </div>
          <div class="migra-row">
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :disabled="!selectionIds.length"
              :title="lockAll ? 'Unlock selection' : 'Lock selection'"
              @click="emit('toggle-lock', selectedId)"
            >
              {{ lockAll ? 'Unlock' : 'Lock' }}
            </button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :disabled="!selectionIds.length"
              :title="hideAll ? 'Unhide selection' : 'Hide selection'"
              @click="emit('toggle-hidden', selectedId)"
            >
              {{ hideAll ? 'Unhide' : 'Hide' }}
            </button>
          </div>
        </div>

        <div
          class="migra-dropzone"
          :class="{ 'migra-dropzone--active': rootDropActive }"
          @dragover.prevent="handleRootDragOver"
          @drop.prevent="handleRootDrop"
        >
          <div v-if="!rootChildren.length" class="px-3 py-6 text-sm migra-muted">
            No elements yet. Add a widget to get started.
          </div>

          <div v-else class="migra-tree">
            <NavigatorNode
              v-for="childId in rootChildren"
              :key="childId"
              :doc="doc"
              :node-id="childId"
              :selected-id="selectedId"
              :query="normalizedQuery"
              :drag-state="dragState"
              :keybindings="keybindings"
              :teleport-wrap="teleportWrap"
              @select="$emit('select', $event)"
              @drag-start="handleDragStart"
              @drag-over="handleDragOver"
              @drop-node="handleDropNode"
              @move="handleDirectMove"
              @toggle-lock="$emit('toggle-lock', $event)"
              @toggle-hidden="$emit('toggle-hidden', $event)"
              @duplicate="$emit('duplicate', $event)"
              @delete="$emit('delete', $event)"
            />
          </div>
        </div>
      </div>
    </MigraCard>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue';
import type { MigraDoc, NodeId } from '@/core/document';
import { findParentId, isDescendant } from '@/core/document';
import { getWidgetDefinition } from '@/core/widgets';
import type { Keybindings } from '@/core/settings';
import { DEFAULT_KEYBINDINGS, matchesCombo } from '@/core/settings';
import MigraCard from '@/ui/MigraCard.vue';

const NavigatorNode = {
  name: 'NavigatorNode',
  props: {
    doc: { type: Object, required: true },
    nodeId: { type: String, required: true },
    selectedId: { type: String, default: null },
    query: { type: String, default: '' },
    dragState: { type: Object, required: true },
    keybindings: { type: Object, required: true },
    teleportWrap: { type: Boolean, default: false },
  },
  emits: ['select', 'drag-start', 'drag-over', 'drop-node', 'move', 'toggle-lock', 'toggle-hidden', 'duplicate', 'delete'],
  setup(props: any, { emit }: any) {
    const node = computed(() => (props.doc as MigraDoc).nodes[props.nodeId] || null);
    const isLockedOwn = computed(() => {
      const p = (node.value?.props ?? {}) as Record<string, any>;
      return Boolean(p.locked === true || p.isLocked === true || p.mgLocked === true);
    });
    const lockingAncestorId = computed(() => {
      const doc = props.doc as MigraDoc;
      if (!doc.nodes?.[props.nodeId]) return null;
      if (isLockedOwn.value) return String(props.nodeId);
      let cur: NodeId = String(props.nodeId);
      while (true) {
        const pid = findParentId(doc, cur);
        if (!pid) return null;
        const parent = doc.nodes[pid];
        const pp = (parent?.props ?? {}) as Record<string, any>;
        const parentLocked = Boolean(pp.locked === true || pp.isLocked === true || pp.mgLocked === true);
        if (parentLocked) return String(pid);
        cur = String(pid);
      }
    });
    const lockState = computed<'none' | 'own' | 'inherited'>(() => {
      if (isLockedOwn.value) return 'own';
      return lockingAncestorId.value ? 'inherited' : 'none';
    });
    const isLocked = computed(() => lockState.value !== 'none');
    const isHidden = computed(() => {
      const p = (node.value?.props ?? {}) as Record<string, any>;
      if (p.hidden === true || p.isHidden === true || p.mgHidden === true) return true;
      const vis = String(p.visibility ?? '').toLowerCase();
      if (vis === 'hidden') return true;
      const disp = String(p.display ?? '').toLowerCase();
      if (disp === 'none') return true;
      return false;
    });
    const isMovable = computed(
      () => props.nodeId !== (props.doc as MigraDoc).rootId && !isLocked.value && !isHidden.value
    );
    const label = computed(() => {
      const n = node.value as any;
      if (!n) return props.nodeId;
      const def = getWidgetDefinition(n.type);
      const title = def?.title || n.type;
      const text =
        typeof n.props?.title === 'string'
          ? n.props.title
          : typeof n.props?.editor === 'string'
            ? n.props.editor
            : typeof n.props?.text === 'string'
              ? n.props.text
              : '';
      const snippet = text ? ` — ${String(text).replace(/\\s+/g, ' ').trim().slice(0, 26)}${String(text).length > 26 ? '…' : ''}` : '';
      return `${title}${snippet}`;
    });

    const isContainer = computed(() => {
      const t = node.value?.type;
      return t === 'root' || t === 'section' || t === 'container';
    });

    const isMatch = computed(() => {
      const q = String(props.query || '').trim().toLowerCase();
      if (!q) return true;
      return label.value.toLowerCase().includes(q);
    });

    const childMatches = computed(() => {
      const q = String(props.query || '').trim().toLowerCase();
      if (!q) return true;
      const n = node.value as any;
      if (!n?.children?.length) return false;
      const stack = [...n.children];
      while (stack.length) {
        const cid = stack.pop();
        const child = (props.doc as MigraDoc).nodes[cid];
        if (!child) continue;
        const def = getWidgetDefinition(child.type);
        const childTitle = def?.title || child.type;
        const text = typeof child.props?.title === 'string' ? child.props.title : typeof child.props?.text === 'string' ? child.props.text : '';
        const childLabel = `${childTitle} ${text || ''}`.toLowerCase();
        if (childLabel.includes(q)) return true;
        if (child.children?.length) stack.push(...child.children);
      }
      return false;
    });

    const visible = computed(() => isMatch.value || childMatches.value);
    const children = computed(() => (node.value?.children || []) as NodeId[]);

    const parentId = computed(() => findParentId(props.doc as MigraDoc, props.nodeId) || (props.doc as MigraDoc).rootId);
    const siblings = computed(() => (((props.doc as MigraDoc).nodes[parentId.value]?.children || []) as NodeId[]));
    const siblingIndex = computed(() => siblings.value.indexOf(String(props.nodeId)));
    const canMoveUp = computed(() => isMovable.value && siblingIndex.value > 0);
    const canMoveDown = computed(
      () => isMovable.value && siblingIndex.value >= 0 && siblingIndex.value < Math.max(0, siblings.value.length - 1)
    );

    const canIndent = computed(() => {
      if (!isMovable.value) return false;
      const idx = siblingIndex.value;
      if (idx <= 0) return false;
      const prevId = siblings.value[idx - 1];
      const prev = (props.doc as MigraDoc).nodes[prevId];
      if (!prev) return false;
      return prev.type === 'section' || prev.type === 'container';
    });

    const canOutdent = computed(() => {
      if (!isMovable.value) return false;
      const pid = parentId.value;
      return pid && pid !== (props.doc as MigraDoc).rootId;
    });

    const showBefore = computed(
      () => props.dragState?.overId === props.nodeId && props.dragState?.position === 'before'
    );
    const showAfter = computed(
      () => props.dragState?.overId === props.nodeId && props.dragState?.position === 'after'
    );
    const showInside = computed(
      () => isContainer.value && props.dragState?.overId === props.nodeId && props.dragState?.position === 'inside'
    );

    function onDragStart(e: DragEvent) {
      if (!isMovable.value) return;
      e.dataTransfer?.setData('text/plain', String(props.nodeId));
      const handle = e.currentTarget as HTMLElement | null;
      const card = handle?.closest?.('[data-migra-node-card]') as HTMLElement | null;
      e.dataTransfer?.setDragImage?.(card || handle || new Image(), 10, 10);
      emit('drag-start', props.nodeId);
    }

    function onDragOver(e: DragEvent) {
      emit('drag-over', { overId: props.nodeId, event: e, isContainer: isContainer.value });
    }

    function onDrop(e: DragEvent) {
      emit('drop-node', { overId: props.nodeId, event: e, isContainer: isContainer.value });
    }

    function onClickCard(e: MouseEvent) {
      emit('select', props.nodeId);
      nextTick(() => {
        const el = e.currentTarget as HTMLElement | null;
        el?.focus?.();
      });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (props.nodeId !== props.selectedId) return;
      const kb = ({ ...DEFAULT_KEYBINDINGS, ...(props.keybindings || {}) } as unknown) as Keybindings;
      const doc = props.doc as MigraDoc;
      const id = String(props.nodeId);

      function findContainingRootSection(nodeId: NodeId): NodeId | null {
        let cur: NodeId | null = nodeId;
        while (cur) {
          const parentId = findParentId(doc, cur);
          if (!parentId) return null;
          if (parentId === doc.rootId) {
            const n = doc.nodes[cur];
            return n?.type === 'section' ? cur : null;
          }
          cur = parentId;
        }
        return null;
      }

      function getRootSections(): NodeId[] {
        const root = doc.nodes[doc.rootId];
        const kids = (root?.children || []) as NodeId[];
        return kids.filter((cid) => doc.nodes[cid]?.type === 'section');
      }

      if (matchesCombo(e, kb.teleportPrevSection) || matchesCombo(e, kb.teleportNextSection)) {
        const rootSectionId =
          (doc.nodes[id]?.type === 'section' && findParentId(doc, id) === doc.rootId ? id : null) ||
          findContainingRootSection(id);
        if (!rootSectionId) return;

        const sections = getRootSections();
        const curIndex = sections.indexOf(rootSectionId);
        if (curIndex < 0) return;

        const wrap = Boolean(props.teleportWrap);
        const isPrev = matchesCombo(e, kb.teleportPrevSection);
        const targetIndex =
          isPrev
            ? curIndex > 0
              ? curIndex - 1
              : wrap
                ? sections.length - 1
                : -1
            : curIndex < sections.length - 1
              ? curIndex + 1
              : wrap
                ? 0
                : -1;
        if (targetIndex < 0) return;
        const targetSectionId = sections[targetIndex];

        e.preventDefault();
        e.stopPropagation();

        if (doc.nodes[id]?.type === 'section' && findParentId(doc, id) === doc.rootId) {
          const rootKids = (doc.nodes[doc.rootId]?.children || []) as NodeId[];
          const targetPos = rootKids.indexOf(targetSectionId);
          if (targetPos < 0) return;
          emit('move', { activeId: id, parentId: doc.rootId, index: isPrev ? targetPos : targetPos + 1 });
          return;
        }

        const targetSection = doc.nodes[targetSectionId];
        const insertIndex = isPrev ? (targetSection?.children || []).length : 0;
        emit('move', { activeId: id, parentId: targetSectionId, index: insertIndex });
        return;
      }

      const parentId = findParentId(doc, id) || doc.rootId;
      const parent = doc.nodes[parentId];
      const siblings = (parent?.children || []) as NodeId[];
      const index = siblings.indexOf(id);
      if (index < 0) return;

      if (matchesCombo(e, kb.outdent)) {
        e.preventDefault();
        e.stopPropagation();
        if (parentId === doc.rootId) return;
        const grandParentId = findParentId(doc, parentId) || doc.rootId;
        const grand = doc.nodes[grandParentId];
        const parentIndex = (grand?.children || []).indexOf(parentId);
        if (parentIndex < 0) return;
        emit('move', { activeId: id, parentId: grandParentId, index: parentIndex + 1 });
        return;
      }

      if (matchesCombo(e, kb.indentPrevSection)) {
        e.preventDefault();
        e.stopPropagation();
        const prevSiblingId = siblings[index - 1];
        if (!prevSiblingId) return;
        const prev = doc.nodes[prevSiblingId];
        if (!prev) return;
        if (prev.type !== 'section' && prev.type !== 'container') return;
        emit('move', { activeId: id, parentId: prevSiblingId, index: (prev.children || []).length });
        return;
      }

      if (matchesCombo(e, kb.jumpPrevParent)) {
        e.preventDefault();
        e.stopPropagation();
        const prevSiblingId = siblings[index - 1];
        if (prevSiblingId) {
          const prev = doc.nodes[prevSiblingId];
          if (prev && (prev.type === 'section' || prev.type === 'container')) {
            emit('move', { activeId: id, parentId: prevSiblingId, index: (prev.children || []).length });
            return;
          }
        }
        if (index === 0 && parentId !== doc.rootId) {
          const grandParentId = findParentId(doc, parentId) || doc.rootId;
          const grand = doc.nodes[grandParentId];
          const parentIndex = (grand?.children || []).indexOf(parentId);
          if (parentIndex < 0) return;
          emit('move', { activeId: id, parentId: grandParentId, index: parentIndex });
          return;
        }
        if (index === 0) return;
        emit('move', { activeId: id, parentId, index: index - 1 });
        return;
      }

      if (matchesCombo(e, kb.jumpNextParent)) {
        e.preventDefault();
        e.stopPropagation();
        const nextSiblingId = siblings[index + 1];
        if (nextSiblingId) {
          const next = doc.nodes[nextSiblingId];
          if (next && (next.type === 'section' || next.type === 'container')) {
            emit('move', { activeId: id, parentId: nextSiblingId, index: 0 });
            return;
          }
        }
        if (index === siblings.length - 1 && parentId !== doc.rootId) {
          const grandParentId = findParentId(doc, parentId) || doc.rootId;
          const grand = doc.nodes[grandParentId];
          const parentIndex = (grand?.children || []).indexOf(parentId);
          if (parentIndex < 0) return;
          emit('move', { activeId: id, parentId: grandParentId, index: parentIndex + 1 });
          return;
        }
        if (index >= siblings.length - 1) return;
        emit('move', { activeId: id, parentId, index: index + 2 });
        return;
      }

      if (matchesCombo(e, kb.jumpTop)) {
        e.preventDefault();
        e.stopPropagation();
        emit('move', { activeId: id, parentId, index: 0 });
        return;
      }

      if (matchesCombo(e, kb.jumpBottom)) {
        e.preventDefault();
        e.stopPropagation();
        emit('move', { activeId: id, parentId, index: siblings.length });
        return;
      }

      if (matchesCombo(e, kb.moveUp)) {
        e.preventDefault();
        e.stopPropagation();
        if (index === 0) return;
        emit('move', { activeId: id, parentId, index: index - 1 });
        return;
      }

      if (matchesCombo(e, kb.moveDown)) {
        e.preventDefault();
        e.stopPropagation();
        if (index >= siblings.length - 1) return;
        emit('move', { activeId: id, parentId, index: index + 2 });
        return;
      }
    }

    function onMoveUpClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (!canMoveUp.value) return;
      emit('move', { activeId: String(props.nodeId), parentId: parentId.value, index: siblingIndex.value - 1 });
    }

    function onMoveDownClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (!canMoveDown.value) return;
      emit('move', { activeId: String(props.nodeId), parentId: parentId.value, index: siblingIndex.value + 2 });
    }

    function onIndentClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (!canIndent.value) return;
      const idx = siblingIndex.value;
      const prevId = siblings.value[idx - 1];
      const prev = (props.doc as MigraDoc).nodes[prevId];
      if (!prev) return;
      emit('move', { activeId: String(props.nodeId), parentId: prevId, index: (prev.children || []).length });
    }

    function onOutdentClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (!canOutdent.value) return;
      const pid = parentId.value;
      const doc = props.doc as MigraDoc;
      const grandId = findParentId(doc, pid) || doc.rootId;
      const grand = doc.nodes[grandId];
      const pIndex = (grand?.children || []).indexOf(pid);
      if (pIndex < 0) return;
      emit('move', { activeId: String(props.nodeId), parentId: grandId, index: pIndex + 1 });
    }

    function onDuplicateClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      emit('duplicate', String(props.nodeId));
    }

    function onDeleteClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      emit('delete', String(props.nodeId));
    }

    function onToggleLockClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      if (lockState.value === 'inherited') return;
      emit('toggle-lock', String(props.nodeId));
    }

    function onToggleHiddenClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();
      emit('toggle-hidden', String(props.nodeId));
    }

    return {
      node,
      label,
      children,
      visible,
      isLocked,
      lockState,
      isHidden,
      isMovable,
      showBefore,
      showAfter,
      showInside,
      onDragStart,
      onDragOver,
      onDrop,
      onClickCard,
      onKeyDown,
      canMoveUp,
      canMoveDown,
      onMoveUpClick,
      onMoveDownClick,
      canIndent,
      canOutdent,
      onIndentClick,
      onOutdentClick,
      onToggleLockClick,
      onToggleHiddenClick,
      onDuplicateClick,
      onDeleteClick,
      emit,
    };
  },
	  template: `
	    <div v-if="visible" class="select-none">
	      <div
	        class="group relative migra-navitem"
	        :class="{
            'migra-navitem--selected': nodeId === selectedId,
            'migra-navitem--locked': isLocked,
            'migra-navitem--locked-inherited': lockState === 'inherited',
            'migra-navitem--hidden': isHidden
          }"
	        :style="showInside ? { boxShadow: 'var(--ring)', borderColor: 'color-mix(in srgb, var(--migra-accent) 55%, transparent)' } : undefined"
	        @dragover.prevent="onDragOver"
	        @drop.prevent="onDrop"
	        @keydown="onKeyDown"
	        :tabindex="nodeId === selectedId ? 0 : -1"
	        data-migra-node-card
	        @click="onClickCard"
	      >
	        <div v-if="showBefore" class="migra-drop-indicator migra-drop-indicator--top"></div>
	        <div v-if="showAfter" class="migra-drop-indicator migra-drop-indicator--bottom"></div>

	        <div class="flex items-center gap-2 min-w-0">
	          <span class="migra-navitem__icon">
	            {{ (node?.type || 'E').charAt(0).toUpperCase() }}
	          </span>
	          <div class="migra-navitem__meta">
	            <div class="migra-navitem__title">{{ label }}</div>
	            <div class="migra-navitem__sub">{{ nodeId }}</div>
	          </div>
	        </div>
	        <button
	          type="button"
	          class="migra-drag-handle migra-btn migra-btn--ghost text-xs opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
	          :class="nodeId === selectedId ? 'opacity-100 pointer-events-auto' : ''"
	          title="Drag"
	          aria-label="Drag"
	          :disabled="!isMovable"
	          :draggable="isMovable"
	          @dragstart="onDragStart"
	          @click.stop="emit('select', nodeId)"
	        >
	          ⋮⋮
	        </button>
          <div
            class="flex items-center gap-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
            :class="nodeId === selectedId ? 'opacity-100 pointer-events-auto' : ''"
          >
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :title="lockState === 'inherited' ? 'Locked by parent' : lockState === 'own' ? 'Unlock' : 'Lock'"
              :disabled="nodeId === doc.rootId || lockState === 'inherited'"
              @click="onToggleLockClick"
            >{{ lockState === 'own' ? '🔒' : lockState === 'inherited' ? '🔐' : '🔓' }}</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              :title="isHidden ? 'Unhide' : 'Hide'"
              :disabled="nodeId === doc.rootId"
              @click="onToggleHiddenClick"
            >{{ isHidden ? '👁' : '🙈' }}</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Move up"
              :disabled="!canMoveUp"
              @click="onMoveUpClick"
            >↑</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Move down"
              :disabled="!canMoveDown"
              @click="onMoveDownClick"
            >↓</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Indent (Tab)"
              :disabled="!canIndent"
              @click="onIndentClick"
            >⇥</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Outdent (Shift+Tab)"
              :disabled="!canOutdent"
              @click="onOutdentClick"
            >⇤</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Duplicate (Ctrl/Cmd+D)"
              :disabled="nodeId === doc.rootId"
              @click="onDuplicateClick"
            >⧉</button>
            <button
              type="button"
              class="migra-btn migra-btn--ghost text-xs"
              title="Delete (Del)"
              :disabled="nodeId === doc.rootId"
              @click="onDeleteClick"
            >⌫</button>
          </div>
	      </div>
	      <div v-if="children.length" class="migra-tree__children">
        <NavigatorNode
          v-for="cid in children"
          :key="cid"
          :doc="doc"
          :node-id="cid"
          :selected-id="selectedId"
          :query="query"
          :drag-state="dragState"
          :keybindings="keybindings"
          :teleport-wrap="teleportWrap"
          @select="$emit('select', $event)"
          @drag-start="$emit('drag-start', $event)"
          @drag-over="$emit('drag-over', $event)"
          @drop-node="$emit('drop-node', $event)"
          @move="$emit('move', $event)"
          @toggle-lock="$emit('toggle-lock', $event)"
          @toggle-hidden="$emit('toggle-hidden', $event)"
          @duplicate="$emit('duplicate', $event)"
          @delete="$emit('delete', $event)"
        />
	      </div>
	    </div>
	  `,
	};

const props = defineProps<{ doc: MigraDoc; selectedId: string | null; selectedIds?: string[]; keybindings: Keybindings; teleportWrap: boolean }>();
const emit = defineEmits<{
  (e: 'select', id: string): void;
  (e: 'move', payload: { activeId: string; parentId: string; index: number }): void;
  (e: 'toggle-lock', id: string | null): void;
  (e: 'toggle-hidden', id: string | null): void;
  (e: 'duplicate', id: string): void;
  (e: 'delete', id: string): void;
}>();

const query = ref('');
const normalizedQuery = computed(() => query.value.trim().toLowerCase());

const rootChildren = computed(() => props.doc.nodes[props.doc.rootId]?.children || []);
const totalNodes = computed(() => Object.keys(props.doc.nodes || {}).length - 1);

function isNodeLockedOwnById(id: string): boolean {
  const n = props.doc.nodes[id];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  return Boolean(p.locked === true || p.isLocked === true || p.mgLocked === true);
}

function findLockingAncestorIdById(nodeId: string): string | null {
  if (!props.doc.nodes[nodeId]) return null;
  if (isNodeLockedOwnById(nodeId)) return nodeId;
  let cur: string = nodeId;
  while (true) {
    const pid = findParentId(props.doc, cur);
    if (!pid) return null;
    if (isNodeLockedOwnById(pid)) return pid;
    cur = pid;
  }
}

function isNodeLockedById(id: string): boolean {
  return Boolean(findLockingAncestorIdById(id));
}

function isNodeHiddenById(id: string): boolean {
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

const selectionIds = computed(() => {
  const ids = (props.selectedIds ?? []).filter((id) => id && id !== props.doc.rootId && Boolean(props.doc.nodes[id]));
  if (ids.length) return ids;
  const sid = String(props.selectedId || '').trim();
  if (sid && sid !== props.doc.rootId && Boolean(props.doc.nodes[sid])) return [sid];
  return [];
});

const lockAll = computed(() => selectionIds.value.length > 0 && selectionIds.value.every((id) => isNodeLockedById(id)));
const hideAll = computed(() => selectionIds.value.length > 0 && selectionIds.value.every((id) => isNodeHiddenById(id)));

const dragState = reactive<{
  activeId: string | null;
  overId: string | null;
  position: 'before' | 'after' | 'inside' | null;
}>({
  activeId: null,
  overId: null,
  position: null,
});

const rootDropActive = computed(() => dragState.activeId && dragState.overId === props.doc.rootId);

function handleDragStart(id: string) {
  dragState.activeId = id;
  dragState.overId = null;
  dragState.position = null;
}

function handleDirectMove(payload: { activeId: string; parentId: string; index: number }) {
  const activeId = String(payload?.activeId || '').trim();
  const parentId = String(payload?.parentId || '').trim();
  const index = Number(payload?.index);
  if (!activeId || !parentId || Number.isNaN(index)) return;
  if (activeId === props.doc.rootId) return;
  if (activeId === parentId) return;
  if (isDescendant(props.doc, activeId, parentId)) return;
  emit('move', { activeId, parentId, index });
}

function computeDropPosition(event: DragEvent, isContainer: boolean): 'before' | 'after' | 'inside' {
  const target = event.currentTarget as HTMLElement | null;
  if (!target) return 'after';
  const rect = target.getBoundingClientRect();
  const y = event.clientY - rect.top;
  const ratio = rect.height > 0 ? y / rect.height : 0.5;
  if (isContainer) {
    if (ratio < 0.28) return 'before';
    if (ratio > 0.72) return 'after';
    return 'inside';
  }
  return ratio < 0.5 ? 'before' : 'after';
}

function handleDragOver(payload: { overId: string; event: DragEvent; isContainer: boolean }) {
  const activeId = dragState.activeId;
  if (!activeId) return;
  dragState.overId = payload.overId;
  dragState.position = computeDropPosition(payload.event, payload.isContainer);
}

function handleDropNode(payload: { overId: string; event: DragEvent; isContainer: boolean }) {
  const activeId = dragState.activeId || payload.event.dataTransfer?.getData('text/plain') || null;
  if (!activeId) return;
  if (activeId === payload.overId) return;
  if (isDescendant(props.doc, activeId, payload.overId)) return;

  const position =
    dragState.overId === payload.overId && dragState.position
      ? dragState.position
      : computeDropPosition(payload.event, payload.isContainer);

  if (position === 'inside') {
    const parent = props.doc.nodes[payload.overId];
    const children = parent?.children || [];
    emit('move', { activeId, parentId: payload.overId, index: children.length });
  } else {
    const parentId = findParentId(props.doc, payload.overId) || props.doc.rootId;
    const parent = props.doc.nodes[parentId];
    const idx = Math.max(0, (parent?.children || []).indexOf(payload.overId));
    const insertIndex = position === 'after' ? idx + 1 : idx;
    emit('move', { activeId, parentId, index: insertIndex });
  }

  dragState.activeId = null;
  dragState.overId = null;
  dragState.position = null;
}

function handleRootDragOver() {
  if (!dragState.activeId) return;
  dragState.overId = props.doc.rootId;
  dragState.position = 'inside';
}

function handleRootDrop() {
  const activeId = dragState.activeId;
  if (!activeId) return;
  const root = props.doc.nodes[props.doc.rootId];
  const children = root?.children || [];
  emit('move', { activeId, parentId: props.doc.rootId, index: children.length });
  dragState.activeId = null;
  dragState.overId = null;
  dragState.position = null;
}
</script>
