<template>
  <div
    class="migra-canvas"
    ref="canvasRef"
    @pointerdown="onCanvasPointerDown"
  >
    <CanvasNode
      :doc="doc"
      :node-id="doc.rootId"
      :parent-id="null"
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

    <div v-if="marquee.active" class="migra-marquee" :style="marqueeStyle"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, reactive, ref } from 'vue';
import type { MigraDoc, NodeId } from '@/core/document';
import { findParentId } from '@/core/document';
import CanvasNode from './canvas/CanvasNode.vue';
import { BUILDER_DND_KEY, useBuilderDnd } from './canvas/useBuilderDnd';
import type { InlineEditSpec } from '@/core/inlineEdit';

const props = defineProps<{
  doc: MigraDoc;
  selectedId: NodeId | null;
  selectedIds: NodeId[];
  inlineEdit: (InlineEditSpec & { nodeId: NodeId }) | null;
  widgets: Array<{ name: string; title: string; category?: string }>;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { id: NodeId; additive: boolean; range: boolean }): void;
  (e: 'set-selection', payload: { ids: NodeId[]; additive: boolean }): void;
  (e: 'move', payload: { activeId: NodeId; parentId: NodeId; index: number }): void;
  (e: 'move-group', payload: { activeId: NodeId; groupIds: NodeId[]; parentId: NodeId; index: number }): void;
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

function nodePropBool(id: NodeId, keys: string[]): boolean {
  const n = props.doc.nodes[id];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, any>;
  for (const k of keys) if (p[k] === true) return true;
  return false;
}

function isNodeLockedOwn(id: NodeId): boolean {
  return nodePropBool(id, ['locked', 'isLocked', 'mgLocked']);
}

function findLockingAncestorId(nodeId: NodeId): NodeId | null {
  if (!props.doc.nodes[nodeId]) return null;
  if (isNodeLockedOwn(nodeId)) return nodeId;

  let cur: NodeId = nodeId;
  // Walk up the tree: if any ancestor is locked, the node is effectively locked.
  while (true) {
    const parentId = findParentId(props.doc, cur);
    if (!parentId) return null;
    if (isNodeLockedOwn(parentId)) return parentId;
    cur = parentId;
  }
}

function isNodeLocked(id: NodeId): boolean {
  return Boolean(findLockingAncestorId(id));
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

function isNodeMovable(id: NodeId): boolean {
  if (id === props.doc.rootId) return false;
  if (!props.doc.nodes[id]) return false;
  if (isNodeLocked(id)) return false;
  if (isNodeHidden(id)) return false;
  return true;
}

function isDropTargetAllowed(parentId: NodeId): boolean {
  // Root always allowed.
  if (parentId === props.doc.rootId) return true;
  // Disallow dropping into locked/hidden containers.
  if (isNodeLocked(parentId) || isNodeHidden(parentId)) return false;
  return true;
}

const dnd = useBuilderDnd({
  getDoc: () => props.doc,
  getSelectedIds: () => props.selectedIds,
  canDrag: isNodeMovable,
  canDropInto: isDropTargetAllowed,
  onMove: (p) => emit('move', p),
  onMoveGroup: (p) => emit('move-group', p),
});

provide(BUILDER_DND_KEY, dnd);

const widgets = props.widgets;

const canvasRef = ref<HTMLElement | null>(null);
const marquee = reactive({
  active: false,
  pointerId: -1,
  additive: false,
  scopeParentId: null as NodeId | null,
  startX: 0,
  startY: 0,
  curX: 0,
  curY: 0,
  thresholdMet: false,
});

function shouldIgnoreMarqueeStart(target: HTMLElement): boolean {
  const ignored = [
    '[data-mg-node-id]',
    '[data-mg-drag-handle="true"]',
    '[data-mg-insert-parent-id][data-mg-insert-index]',
    '.migra-inlinebar',
    '.migra-insertbar-pop',
    'input',
    'textarea',
    'select',
    'button',
    'a',
  ].join(',');
  return Boolean(target.closest(ignored));
}

function rectFromPoints() {
  const left = Math.min(marquee.startX, marquee.curX);
  const top = Math.min(marquee.startY, marquee.curY);
  const right = Math.max(marquee.startX, marquee.curX);
  const bottom = Math.max(marquee.startY, marquee.curY);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

const marqueeStyle = computed(() => {
  const r = rectFromPoints();
  return { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` };
});

function intersects(a: ReturnType<typeof rectFromPoints>, b: DOMRect) {
  return !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
}

function containsFully(a: ReturnType<typeof rectFromPoints>, b: DOMRect, tolerancePx = 2) {
  return (
    b.left >= a.left - tolerancePx &&
    b.top >= a.top - tolerancePx &&
    b.right <= a.right + tolerancePx &&
    b.bottom <= a.bottom + tolerancePx
  );
}

function isDomSelectable(el: HTMLElement): boolean {
  const cs = window.getComputedStyle(el);
  if (cs.display === 'none') return false;
  if (cs.visibility === 'hidden') return false;
  if (Number(cs.opacity) === 0) return false;
  if (cs.pointerEvents === 'none') return false;
  return true;
}

function isNodeSelectable(id: NodeId): boolean {
  const n = props.doc.nodes[id];
  if (!n) return false;
  const p = (n.props ?? {}) as Record<string, unknown>;

  if (isNodeLocked(id)) return false;

  const hidden = Boolean((p as any).hidden ?? (p as any).isHidden ?? (p as any).mgHidden);
  if (hidden) return false;

  const visibility = String(((p as any).visibility ?? '') as any).toLowerCase();
  if (visibility === 'hidden') return false;

  const display = String(((p as any).display ?? '') as any).toLowerCase();
  if (display === 'none') return false;

  return true;
}

function closestEl(el: Element | null, sel: string): HTMLElement | null {
  if (!el) return null;
  return (el as HTMLElement).closest(sel) as HTMLElement | null;
}

function onCanvasPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  if (dnd.state.dragging) return;

  const canvas = canvasRef.value;
  const target = e.target as HTMLElement | null;
  if (!canvas || !target) return;
  if (!canvas.contains(target)) return;
  if (shouldIgnoreMarqueeStart(target)) return;

  // Scope marquee selection to the list where it started (Elementor-style):
  // select only nodes whose direct parent list matches this ID.
  const listEl = closestEl(target, '.migra-children-list') ?? canvas.querySelector<HTMLElement>('.migra-children-list');
  marquee.scopeParentId = ((listEl?.dataset.mgParentId as NodeId | undefined) ?? props.doc.rootId) as NodeId;

  marquee.active = true;
  marquee.pointerId = e.pointerId;
  marquee.additive = Boolean(e.metaKey || e.ctrlKey);
  marquee.startX = e.clientX;
  marquee.startY = e.clientY;
  marquee.curX = e.clientX;
  marquee.curY = e.clientY;
  marquee.thresholdMet = false;

  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    // ignore
  }

  e.preventDefault();
}

function onPointerMove(e: PointerEvent) {
  if (!marquee.active || e.pointerId !== marquee.pointerId) return;
  marquee.curX = e.clientX;
  marquee.curY = e.clientY;
  const dx = Math.abs(marquee.curX - marquee.startX);
  const dy = Math.abs(marquee.curY - marquee.startY);
  marquee.thresholdMet = Math.max(dx, dy) >= 5;
  e.preventDefault();
}

function endMarquee(e?: PointerEvent) {
  if (!marquee.active) return;
  if (e && e.pointerId !== marquee.pointerId) return;

  const didDrag = marquee.thresholdMet;
  marquee.active = false;
  marquee.pointerId = -1;
  const scopeParentId = marquee.scopeParentId;
  marquee.scopeParentId = null;

  if (!didDrag) {
    // Click on empty canvas background.
    emit('select', { id: props.doc.rootId, additive: marquee.additive, range: false });
    return;
  }

  const canvas = canvasRef.value;
  if (!canvas) return;

  const r = rectFromPoints();
  const nodeEls = Array.from(canvas.querySelectorAll<HTMLElement>('[data-mg-node-id]'));
  const ids: NodeId[] = [];

  for (const el of nodeEls) {
    const id = el.dataset.mgNodeId as NodeId | undefined;
    if (!id || id === props.doc.rootId) continue;
    // Only select direct children of the list/container where marquee started.
    if (scopeParentId && (el.dataset.mgParentId as NodeId | undefined) !== scopeParentId) continue;
    if (!isDomSelectable(el)) continue;
    if (!isNodeSelectable(id)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) continue;
    // Precision select: marquee must fully contain the node bounds.
    if (containsFully(r, rect, 2)) ids.push(id);
  }

  emit('set-selection', { ids, additive: marquee.additive });
}

onMounted(() => {
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', endMarquee, { passive: true });
});

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endMarquee);
});
</script>
