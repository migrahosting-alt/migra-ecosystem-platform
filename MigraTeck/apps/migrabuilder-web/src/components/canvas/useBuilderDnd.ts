import { onBeforeUnmount, onMounted, reactive, type InjectionKey } from 'vue';

import type { MigraDoc, NodeId } from '@/core/document';
import { findParentId, isDescendant } from '@/core/document';

export type DropPosition = 'before' | 'after' | 'inside' | 'none';

export type BuilderDndState = {
  dragging: boolean;
  activeId: NodeId | null;
  groupIds: NodeId[];
  overNodeId: NodeId | null;
  overListParentId: NodeId | null;
  position: DropPosition;
  toParentId: NodeId | null;
  toIndex: number;
};

type DragGhost = { el: HTMLDivElement; cleanup: () => void };

export type BuilderDndApi = {
  state: BuilderDndState;
  startDrag: (activeId: NodeId, e: PointerEvent) => void;
  clear: () => void;
};

export const BUILDER_DND_KEY: InjectionKey<BuilderDndApi> = Symbol('migra.builder.dnd');

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function closestEl(el: Element | null, sel: string): HTMLElement | null {
  if (!el) return null;
  return (el as HTMLElement).closest(sel) as HTMLElement | null;
}

function isContainerType(type: string | null | undefined): boolean {
  return type === 'root' || type === 'section' || type === 'container';
}

function createGhost(fromEl: HTMLElement, clientX: number, clientY: number): DragGhost {
  const rect = fromEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'migra-dnd-ghost';
  el.style.left = `${clientX - rect.width / 2}px`;
  el.style.top = `${clientY - rect.height / 2}px`;
  el.style.width = `${Math.max(240, rect.width)}px`;

  const clone = fromEl.cloneNode(true) as HTMLElement;
  clone.classList.add('migra-dnd-ghost__inner');
  el.appendChild(clone);

  document.body.appendChild(el);

  return {
    el,
    cleanup: () => el.remove(),
  };
}

function computeDrop(opts: {
  doc: MigraDoc;
  activeId: NodeId;
  overNodeId: NodeId | null;
  overListParentId: NodeId | null;
  clientY: number;
}): { toParentId: NodeId | null; toIndex: number; position: DropPosition } {
  const { doc, activeId, overNodeId, overListParentId, clientY } = opts;

  // Hovering a list (empty space) => drop at end.
  if (!overNodeId && overListParentId) {
    const toParentId = overListParentId;
    const toIndex = (doc.nodes[toParentId]?.children ?? []).length;
    return { toParentId, toIndex, position: 'inside' };
  }

  if (!overNodeId) return { toParentId: null, toIndex: -1, position: 'none' };
  if (overNodeId === activeId) return { toParentId: null, toIndex: -1, position: 'none' };

  const overEl = document.querySelector(`[data-mg-node-id="${CSS.escape(String(overNodeId))}"]`) as HTMLElement | null;
  if (!overEl) return { toParentId: null, toIndex: -1, position: 'none' };

  const rect = overEl.getBoundingClientRect();
  const ratio = rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5;

  const overNode = doc.nodes[overNodeId];
  const canNestInside = isContainerType(overNode?.type);

  // Middle region => inside (if allowed)
  if (canNestInside && ratio > 0.25 && ratio < 0.75) {
    const toParentId = overNodeId;
    const toIndex = (doc.nodes[toParentId]?.children ?? []).length;
    return { toParentId, toIndex, position: 'inside' };
  }

  // Otherwise before/after relative to over node in its parent list.
  const parentId = findParentId(doc, overNodeId);
  if (!parentId) return { toParentId: null, toIndex: -1, position: 'none' };

  const siblings = doc.nodes[parentId]?.children ?? [];
  const overIndex = siblings.indexOf(overNodeId);
  if (overIndex < 0) return { toParentId: null, toIndex: -1, position: 'none' };

  const position: DropPosition = ratio <= 0.5 ? 'before' : 'after';
  const toIndex = overIndex + (position === 'after' ? 1 : 0);
  return { toParentId: parentId, toIndex, position };
}

export function useBuilderDnd(opts: {
  getDoc: () => MigraDoc;
  getSelectedIds?: () => NodeId[];
  canDrag?: (id: NodeId) => boolean;
  canDropInto?: (parentId: NodeId) => boolean;
  onMove: (payload: { activeId: NodeId; parentId: NodeId; index: number }) => void;
  onMoveGroup?: (payload: { activeId: NodeId; groupIds: NodeId[]; parentId: NodeId; index: number }) => void;
}): BuilderDndApi {
  const state = reactive<BuilderDndState>({
    dragging: false,
    activeId: null,
    groupIds: [],
    overNodeId: null,
    overListParentId: null,
    position: 'none',
    toParentId: null,
    toIndex: -1,
  });

  let ghost: DragGhost | null = null;

  function computeGroupIds(doc: MigraDoc, activeId: NodeId): NodeId[] {
    const sel = (opts.getSelectedIds?.() ?? []).filter((id) => id && id !== doc.rootId);
    if (sel.length <= 1) return [];
    if (!sel.includes(activeId)) return [];

    if (opts.canDrag) {
      // Enterprise: group drag only if ALL selected nodes are movable.
      for (const id of sel) {
        if (!opts.canDrag(id)) return [];
      }
    }

    const parentId = findParentId(doc, activeId);
    if (!parentId) return [];

    for (const id of sel) {
      if (findParentId(doc, id) !== parentId) return [];
    }

    const set = new Set(sel);
    const siblings = doc.nodes[parentId]?.children ?? [];
    return siblings.filter((id) => set.has(id));
  }

  function wouldDropIntoOwnDescendant(doc: MigraDoc, toParentId: NodeId, group: NodeId[], activeId: NodeId): boolean {
    const ids = group.length ? group : [activeId];
    for (const id of ids) {
      if (isDescendant(doc, id, toParentId)) return true;
    }
    return false;
  }

  function clear() {
    state.dragging = false;
    state.activeId = null;
    state.groupIds = [];
    state.overNodeId = null;
    state.overListParentId = null;
    state.position = 'none';
    state.toParentId = null;
    state.toIndex = -1;
  }

  function startDrag(activeId: NodeId, e: PointerEvent) {
    const doc = opts.getDoc();
    if (!doc.nodes[activeId]) return;
    if (opts.canDrag && !opts.canDrag(activeId)) return;

    const handleEl = e.currentTarget as HTMLElement | null;
    const nodeEl = handleEl?.closest?.('[data-mg-node-id]') as HTMLElement | null;
    const badgeEl =
      (nodeEl?.querySelector?.('.migra-node__badge') as HTMLElement | null) ||
      (nodeEl as HTMLElement | null) ||
      handleEl;

    if (!badgeEl) return;

    state.activeId = activeId;
    state.dragging = true;
    state.groupIds = computeGroupIds(doc, activeId);

    ghost?.cleanup();
    ghost = createGhost(badgeEl, e.clientX, e.clientY);
    if (state.groupIds.length > 1) {
      const badge = document.createElement('div');
      badge.className = 'migra-dnd-ghost__badge';
      badge.textContent = String(state.groupIds.length);
      ghost.el.appendChild(badge);
    }

    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }

    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e: PointerEvent) {
    if (!state.dragging || !state.activeId) return;

    if (ghost) {
      ghost.el.style.left = `${e.clientX - ghost.el.offsetWidth / 2}px`;
      ghost.el.style.top = `${e.clientY - 14}px`;
    }

    const doc = opts.getDoc();

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const insertEl = closestEl(el, '[data-mg-insert-parent-id][data-mg-insert-index]');
    const nodeEl = closestEl(el, '[data-mg-node-id]');
    const listEl = closestEl(el, '.migra-children-list');

    if (insertEl) {
      const toParentId = (insertEl.dataset.mgInsertParentId as NodeId | undefined) ?? null;
      const toIndexRaw = Number(insertEl.dataset.mgInsertIndex ?? NaN);

      if (toParentId && !Number.isNaN(toIndexRaw)) {
        if (opts.canDropInto && !opts.canDropInto(toParentId)) {
          state.overNodeId = null;
          state.overListParentId = null;
          state.position = 'none';
          state.toParentId = null;
          state.toIndex = -1;
          return;
        }

        if (wouldDropIntoOwnDescendant(doc, toParentId, state.groupIds, state.activeId)) {
          state.overNodeId = null;
          state.overListParentId = null;
          state.position = 'none';
          state.toParentId = null;
          state.toIndex = -1;
          return;
        }

        state.overNodeId = null;
        state.overListParentId = null;
        state.position = 'none';
        state.toParentId = toParentId;
        state.toIndex = Math.max(0, Math.floor(toIndexRaw));
        return;
      }
    }

    const overNodeId = (nodeEl?.dataset?.mgNodeId as NodeId | undefined) ?? null;
    const overListParentId = (listEl?.dataset?.mgParentId as NodeId | undefined) ?? null;

    const drop = computeDrop({
      doc,
      activeId: state.activeId,
      overNodeId,
      overListParentId,
      clientY: e.clientY,
    });

    if (drop.toParentId && opts.canDropInto && !opts.canDropInto(drop.toParentId)) {
      state.overNodeId = null;
      state.overListParentId = null;
      state.position = 'none';
      state.toParentId = null;
      state.toIndex = -1;
      return;
    }

    // Prevent dropping into own descendants (no visual target).
    if (drop.toParentId && wouldDropIntoOwnDescendant(doc, drop.toParentId, state.groupIds, state.activeId)) {
      state.overNodeId = null;
      state.overListParentId = null;
      state.position = 'none';
      state.toParentId = null;
      state.toIndex = -1;
      return;
    }

    state.overNodeId = drop.position === 'inside' ? overNodeId : overNodeId;
    state.overListParentId = overListParentId;
    state.position = drop.position;
    state.toParentId = drop.toParentId;
    state.toIndex = drop.toIndex;
  }

  function onPointerUp() {
    if (!state.dragging || !state.activeId) return;

    const activeId = state.activeId;
    const toParentId = state.toParentId;
    const toIndex = state.toIndex;
    const groupIds = state.groupIds.slice();

    ghost?.cleanup();
    ghost = null;

    clear();

    if (toParentId && toIndex >= 0) {
      if (groupIds.length > 1 && opts.onMoveGroup) {
        opts.onMoveGroup({ activeId, groupIds, parentId: toParentId, index: toIndex });
      } else {
        opts.onMove({ activeId, parentId: toParentId, index: toIndex });
      }
    }
  }

  onMounted(() => {
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
  });

  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    ghost?.cleanup();
  });

  return { state, startDrag, clear };
}
