<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EditorStore } from '../../core/editorStore';
import type { NodeId } from '../../core/document';

const props = defineProps<{ nodeId: NodeId }>();

const store = inject<EditorStore>('migraStore')!;

const btnRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLDivElement | null>(null);
const open = ref(false);
const pos = ref({ left: 0, top: 0 });

const lock = computed(() => store.getEffectiveLockState(props.nodeId));
const hidden = computed(() => store.isNodeHidden(props.nodeId));
const structureLocked = computed(() => store.isStructureLocked(props.nodeId));
const editLocked = computed(() => store.isEditLocked(props.nodeId));

const badgeText = computed(() => {
  if (hidden.value) return 'Hidden';
  if (editLocked.value) return lock.value.inherited ? 'Locked (inherited)' : 'Locked';
  if (structureLocked.value) return lock.value.inherited ? 'Structure locked (inherited)' : 'Structure locked';
  return '';
});

const nodeTitle = computed(() => store.getNodeTitle(props.nodeId));
const ancestors = computed(() => store.getAncestorChain(props.nodeId));
const immediateParentId = computed<NodeId | null>(() => ancestors.value[0] ?? null);
const lockingAncestorId = computed(() => lock.value.lockingAncestorId);

const rows = computed(() => {
  return ancestors.value.map((id) => {
    const own = store.getOwnLockMode(id);
    const isLocking = lockingAncestorId.value === id;

    const icon =
      id === store.doc.rootId
        ? '🏠'
        : isLocking
          ? lock.value.mode === 'full'
            ? '🔒'
            : '🧱'
          : own === 'full'
            ? '🔒'
            : own === 'structure'
              ? '🧱'
              : '•';

    const hint =
      isLocking
        ? 'locking parent'
        : own === 'full'
          ? 'full lock'
          : own === 'structure'
            ? 'structure lock'
            : 'unlocked';

    const childCount = (store.getChildIds ? store.getChildIds(id) : (store.doc.nodes[id]?.children ?? [])).length;

    return {
      id,
      icon,
      hint,
      title: store.getNodeTitle(id),
      own,
      isLocking,
      childCount,
    };
  });
});

const parentChildren = computed<NodeId[]>(() => {
  const pid = immediateParentId.value;
  if (!pid) return [];
  return store.getChildIds ? store.getChildIds(pid) : (store.doc.nodes[pid]?.children ?? []);
});

const parentChildCount = computed(() => parentChildren.value.length);
const siblingPreview = computed(() => {
  const kids = parentChildren.value;
  const idx = kids.indexOf(props.nodeId);
  if (idx < 0) return { before: [] as NodeId[], after: [] as NodeId[], hasMoreBefore: false, hasMoreAfter: false };

  const span = 3;
  const start = Math.max(0, idx - span);
  const end = Math.min(kids.length, idx + span + 1);

  return {
    before: kids.slice(start, idx),
    after: kids.slice(idx + 1, end),
    hasMoreBefore: start > 0,
    hasMoreAfter: end < kids.length,
  };
});

const lockingChildren = computed<NodeId[]>(() => {
  const lid = lockingAncestorId.value;
  if (!lid) return [];
  return store.getChildIds ? store.getChildIds(lid) : (store.doc.nodes[lid]?.children ?? []);
});

const lockingChildCount = computed(() => lockingChildren.value.length);
const lockingChildrenPreview = computed(() => lockingChildren.value.slice(0, 6));
const lockingChildrenHasMore = computed(() => lockingChildren.value.length > 6);

const canUnlockHere = computed(() => {
  const lid = lockingAncestorId.value;
  if (!lid) return false;
  if (lid === store.doc.rootId) return false;
  return store.getOwnLockMode(lid) !== 'none';
});

function unlockHere() {
  const lid = lockingAncestorId.value;
  if (!lid || !canUnlockHere.value) return;
  store.patchNodesProps([lid], { locked: false, lockMode: 'none', lockStructure: false }, 'navigator');
}

function computePosition() {
  const el = btnRef.value;
  if (!el) return;

  const r = el.getBoundingClientRect();
  const w = 720;
  const gap = 10;

  const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.right - w));
  const top = Math.max(12, Math.min(window.innerHeight - 480, r.bottom + gap));

  pos.value = { left, top };
}

function close() {
  open.value = false;
}

const activeIndex = ref(0);

function focusPanel() {
  panelRef.value?.focus();
}

function focusActiveRow() {
  const panel = panelRef.value;
  if (!panel) return;
  const btns = panel.querySelectorAll<HTMLButtonElement>('[data-crumb-row="true"]');
  if (!btns.length) return;
  const idx = Math.max(0, Math.min(btns.length - 1, activeIndex.value));
  const el = btns[idx];
  el?.focus();
  el?.scrollIntoView({ block: 'nearest' });
}

function openPopover() {
  if (!badgeText.value) return;
  open.value = true;
  nextTick(() => {
    computePosition();
    activeIndex.value = 0;
    focusPanel();
    nextTick(() => focusActiveRow());
  });
}

function toggle() {
  if (!badgeText.value) return;
  if (open.value) close();
  else openPopover();
}

function onDocDown(e: MouseEvent) {
  if (!open.value) return;
  const t = e.target as Node;
  if (panelRef.value?.contains(t)) return;
  if (btnRef.value?.contains(t as any)) return;
  close();
}

function onScrollOrResize() {
  if (!open.value) return;
  computePosition();
}

function selectAndClose(id: NodeId) {
  store.selectSingle(id);
  close();
}

function selectAndStay(id: NodeId) {
  store.selectSingle(id);
  nextTick(() => focusPanel());
}

function toggleAndStay(id: NodeId) {
  store.toggleSelect(id);
  nextTick(() => focusPanel());
}

function selectAncestor(id: NodeId, keepOpen: boolean) {
  if (keepOpen) selectAndStay(id);
  else selectAndClose(id);
}

const typeaheadBuf = ref('');
let typeaheadTimer: number | null = null;

function clearTypeahead() {
  typeaheadBuf.value = '';
  if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
  typeaheadTimer = null;
}

function resetTypeaheadSoon() {
  if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
  typeaheadTimer = window.setTimeout(() => {
    typeaheadBuf.value = '';
    typeaheadTimer = null;
  }, 700);
}

function matchIndexByTypeahead(q: string) {
  const query = q.trim().toLowerCase();
  if (!query) return -1;
  const list = rows.value;
  let idx = list.findIndex((r) => (r.title || '').toLowerCase().startsWith(query));
  if (idx !== -1) return idx;
  idx = list.findIndex((r) => (r.title || '').toLowerCase().includes(query));
  return idx;
}

function applyTypeaheadJump() {
  const idx = matchIndexByTypeahead(typeaheadBuf.value);
  if (idx !== -1) {
    activeIndex.value = idx;
    nextTick(() => focusActiveRow());
  }
}

function handleTypeaheadChar(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1) return false;
  if (!/[\p{L}\p{N}\s\-_.'"]/u.test(e.key)) return false;
  typeaheadBuf.value = (typeaheadBuf.value + e.key).slice(0, 40);
  resetTypeaheadSoon();
  applyTypeaheadJump();
  e.preventDefault();
  return true;
}

function handleTypeaheadBackspace(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key !== 'Backspace') return false;
  if (!typeaheadBuf.value) return false;
  typeaheadBuf.value = typeaheadBuf.value.slice(0, -1);
  resetTypeaheadSoon();
  applyTypeaheadJump();
  e.preventDefault();
  return true;
}

function onPanelKeyDown(e: KeyboardEvent) {
  if (!open.value) return;
  if (handleTypeaheadBackspace(e)) return;
  if (handleTypeaheadChar(e)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    clearTypeahead();
    close();
    btnRef.value?.focus();
    return;
  }

  const count = rows.value.length;
  if (!count) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(count - 1, activeIndex.value + 1);
    focusActiveRow();
    return;
  }

  if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
    focusActiveRow();
    return;
  }

  if (e.key === 'Home') {
    e.preventDefault();
    activeIndex.value = 0;
    focusActiveRow();
    return;
  }

  if (e.key === 'End') {
    e.preventDefault();
    activeIndex.value = count - 1;
    focusActiveRow();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    const row = rows.value[activeIndex.value];
    if (!row) return;
    const keepOpen = e.ctrlKey || e.metaKey;
    selectAncestor(row.id, keepOpen);
    return;
  }

  if (e.key === 'u' || e.key === 'U') {
    e.preventDefault();
    if (canUnlockHere.value) unlockHere();
    return;
  }
}

function onRowFocus(idx: number) {
  activeIndex.value = idx;
}

function onPillClick(id: NodeId, e: MouseEvent) {
  if (e.ctrlKey || e.metaKey) toggleAndStay(id);
  else selectAndStay(id);
}

onMounted(() => {
  document.addEventListener('mousedown', onDocDown, { capture: true });
  window.addEventListener('scroll', onScrollOrResize, { passive: true, capture: true });
  window.addEventListener('resize', onScrollOrResize, { passive: true });
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onDocDown, { capture: true } as any);
  window.removeEventListener('scroll', onScrollOrResize, { capture: true } as any);
  window.removeEventListener('resize', onScrollOrResize);
  if (typeaheadTimer) window.clearTimeout(typeaheadTimer);
});
</script>

<template>
  <button
    v-if="badgeText"
    ref="btnRef"
    class="mg-node-overlay mg-badge-btn"
    type="button"
    :title="open ? 'Close breadcrumb' : 'Open breadcrumb'"
    @click.stop="toggle"
  >
    <span class="mg-badge">
      {{ badgeText }}
      <span class="mg-badge-link">• breadcrumb</span>
    </span>
  </button>

  <teleport to="body">
    <div
      v-if="open"
      ref="panelRef"
      class="mg-lockcrumb"
      :style="{ left: pos.left + 'px', top: pos.top + 'px' }"
      tabindex="0"
      @keydown="onPanelKeyDown"
      @click.stop
    >
      <div class="mg-lockcrumb__head">
        <div class="mg-strong">Ancestor breadcrumb</div>

        <div class="mg-lockcrumb__meta">
          <div class="mg-muted mg-lockcrumb__metaLeft">
            {{ nodeTitle || props.nodeId }}
            <span v-if="lockingAncestorId"> • locking: {{ store.getNodeTitle(lockingAncestorId!) }}</span>
            <span class="mg-muted">
              • keys: ↑↓, Enter (Ctrl/Cmd keeps open), U unlock, Esc close, type to jump, Backspace edits
            </span>
          </div>

          <div v-if="typeaheadBuf" class="mg-lockcrumb__typeahead">
            <span class="mg-typeahead-pill" :title="`Typeahead: ${typeaheadBuf}`">{{ typeaheadBuf }}</span>
          </div>
        </div>
      </div>

      <div class="mg-lockcrumb__grid">
        <div class="mg-lockcrumb__col">
          <div class="mg-lockcrumb__sectionTitle">Ancestors</div>

          <div class="mg-lockcrumb__list">
            <button
              v-for="(r, idx) in rows"
              :key="r.id"
              class="mg-lockcrumb__row"
              type="button"
              data-crumb-row="true"
              @focus="onRowFocus(idx)"
              @click="selectAncestor(r.id, $event.ctrlKey || $event.metaKey)"
              :data-active="idx === activeIndex ? 'true' : 'false'"
            >
              <span class="mg-lockcrumb__ico">{{ r.icon }}</span>
              <span class="mg-lockcrumb__txt">
                <span class="mg-strong">{{ r.title || r.id }}</span>
                <span class="mg-muted">• {{ r.hint }} • {{ r.childCount }} children</span>
              </span>
              <span v-if="r.isLocking" class="mg-lockcrumb__tag">LOCKING</span>
            </button>

            <div v-if="rows.length === 0" class="mg-lockcrumb__empty mg-muted">
              No ancestors found.
            </div>
          </div>
        </div>

        <div class="mg-lockcrumb__col mg-lockcrumb__preview">
          <div class="mg-lockcrumb__sectionTitle">Mini tree preview</div>

          <div class="mg-lockcrumb__card" v-if="immediateParentId">
            <div class="mg-strong">Immediate parent</div>
            <div class="mg-muted">
              {{ store.getNodeTitle(immediateParentId!) }} • {{ parentChildCount }} children
            </div>

            <div class="mg-lockcrumb__siblings">
              <span v-if="siblingPreview.hasMoreBefore" class="mg-muted">…</span>

              <button
                v-for="id in siblingPreview.before"
                :key="id"
                class="mg-pill mg-pill-btn"
                type="button"
                :title="store.getNodeTitle(id)"
                @click.stop="onPillClick(id, $event)"
              >
                {{ store.getNodeTitle(id) }}
              </button>

              <span class="mg-pill mg-pill--active" :title="nodeTitle">
                {{ nodeTitle || props.nodeId }}
              </span>

              <button
                v-for="id in siblingPreview.after"
                :key="id"
                class="mg-pill mg-pill-btn"
                type="button"
                :title="store.getNodeTitle(id)"
                @click.stop="onPillClick(id, $event)"
              >
                {{ store.getNodeTitle(id) }}
              </button>

              <span v-if="siblingPreview.hasMoreAfter" class="mg-muted">…</span>
            </div>
          </div>

          <div class="mg-lockcrumb__card" v-if="lockingAncestorId">
            <div class="mg-strong">Locking ancestor</div>
            <div class="mg-muted">
              {{ store.getNodeTitle(lockingAncestorId!) }} • {{ lockingChildCount }} children
            </div>

            <div class="mg-lockcrumb__children">
              <button
                v-for="id in lockingChildrenPreview"
                :key="id"
                class="mg-pill mg-pill-btn"
                type="button"
                :title="store.getNodeTitle(id)"
                @click.stop="onPillClick(id, $event)"
              >
                {{ store.getNodeTitle(id) }}
              </button>
              <span v-if="lockingChildrenHasMore" class="mg-muted">…</span>
            </div>
          </div>

          <div v-if="!immediateParentId && !lockingAncestorId" class="mg-lockcrumb__card">
            <div class="mg-muted">No preview available.</div>
          </div>
        </div>
      </div>

      <div class="mg-lockcrumb__foot">
        <button
          class="mg-btn mg-btn--secondary"
          type="button"
          :disabled="!canUnlockHere"
          :title="canUnlockHere ? 'Unlock the locking ancestor (U)' : 'No unlockable locking ancestor'"
          @click="unlockHere"
        >
          Unlock here
        </button>

        <button
          class="mg-btn mg-btn--secondary"
          type="button"
          v-if="lockingAncestorId"
          @click="selectAndClose(lockingAncestorId!)"
        >
          Select locking parent
        </button>

        <button class="mg-btn" type="button" @click="close">Close</button>
      </div>
    </div>
  </teleport>
</template>
