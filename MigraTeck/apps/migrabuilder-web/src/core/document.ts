export type NodeId = string;

export type DocNode = {
  id: NodeId;
  type: string;
  props: Record<string, any>;
  children: NodeId[];
};

export type MigraDoc = {
  version: number;
  rootId: NodeId;
  nodes: Record<NodeId, DocNode>;
};

export type LegacyElement = {
  id: string;
  widgetType: string;
  settings?: Record<string, any>;
  elements?: LegacyElement[];
};

function safeClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isDoc(value: any): value is MigraDoc {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.version === 'number' &&
    typeof value.rootId === 'string' &&
    value.nodes &&
    typeof value.nodes === 'object'
  );
}

export function createEmptyDoc(): MigraDoc {
  return {
    version: 1,
    rootId: 'root',
    nodes: {
      root: { id: 'root', type: 'root', props: {}, children: [] },
    },
  };
}

export function legacyToDoc(elements: LegacyElement[] = []): MigraDoc {
  const doc = createEmptyDoc();

  function visit(element: LegacyElement): NodeId {
    const id = String(element.id || '').trim() || makeId('n');
    const children = Array.isArray(element.elements) ? element.elements : [];
    doc.nodes[id] = {
      id,
      type: String(element.widgetType || 'unknown'),
      props: safeClone(element.settings || {}),
      children: children.map(visit),
    };
    return id;
  }

  doc.nodes[doc.rootId].children = (elements || []).map(visit);
  return doc;
}

export function docToLegacy(doc: MigraDoc): LegacyElement[] {
  const root = doc.nodes[doc.rootId];
  if (!root) return [];

  function visit(id: NodeId): LegacyElement | null {
    const node = doc.nodes[id];
    if (!node) return null;
    return {
      id: node.id,
      widgetType: node.type,
      settings: safeClone(node.props || {}),
      elements: node.children.map(visit).filter(Boolean) as LegacyElement[],
    };
  }

  return (root.children || []).map(visit).filter(Boolean) as LegacyElement[];
}

export function patchNodeProps(doc: MigraDoc, id: NodeId, patch: Record<string, any>): MigraDoc {
  const next = safeClone(doc);
  const node = next.nodes[id];
  if (!node) return next;
  node.props = { ...(node.props || {}), ...(patch || {}) };
  return next;
}

export function findParentId(doc: MigraDoc, childId: NodeId): NodeId | null {
  for (const node of Object.values(doc.nodes)) {
    if (Array.isArray(node.children) && node.children.includes(childId)) return node.id;
  }
  return null;
}

export function isDescendant(doc: MigraDoc, candidateParentId: NodeId, nodeId: NodeId): boolean {
  if (candidateParentId === nodeId) return true;
  const parent = doc.nodes[candidateParentId];
  if (!parent) return false;
  const stack = [...(parent.children || [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === nodeId) return true;
    const n = doc.nodes[cur];
    if (n?.children?.length) stack.push(...n.children);
  }
  return false;
}

export function moveNode(
  doc: MigraDoc,
  activeId: NodeId,
  targetParentId: NodeId,
  targetIndex: number,
): MigraDoc {
  const next = safeClone(doc);
  const node = next.nodes[activeId];
  const targetParent = next.nodes[targetParentId];
  if (!node || !targetParent) return next;

  const fromParentId = findParentId(next, activeId);
  const fromIndex =
    fromParentId && next.nodes[fromParentId]?.children
      ? next.nodes[fromParentId].children.indexOf(activeId)
      : -1;
  if (fromParentId) {
    const fromParent = next.nodes[fromParentId];
    if (fromParent?.children?.length) {
      fromParent.children = fromParent.children.filter((id) => id !== activeId);
    }
  }

  const children = Array.isArray(targetParent.children) ? targetParent.children : [];
  const adjustedIndex =
    fromParentId === targetParentId && fromIndex >= 0 && targetIndex > fromIndex
      ? targetIndex - 1
      : targetIndex;
  const clampedIndex = Math.max(0, Math.min(adjustedIndex, children.length));
  targetParent.children = [...children.slice(0, clampedIndex), activeId, ...children.slice(clampedIndex)];
  return next;
}

export function addNode(
  doc: MigraDoc,
  parentId: NodeId,
  type: string,
  props: Record<string, any>,
): { doc: MigraDoc; id: NodeId } {
  const next = safeClone(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc: next, id: '' };

  const id = makeId('n');
  next.nodes[id] = { id, type, props: safeClone(props || {}), children: [] };
  parent.children = [...(parent.children || []), id];
  return { doc: next, id };
}

export function makeId(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function collectSubtreeIds(doc: MigraDoc, rootId: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const stack: NodeId[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    out.push(id);
    const node = doc.nodes[id];
    if (node?.children?.length) {
      for (const cid of node.children) stack.push(cid);
    }
  }
  return out;
}

export function deleteNode(doc: MigraDoc, id: NodeId): MigraDoc {
  if (!id || id === doc.rootId) return doc;
  const next = safeClone(doc);
  const parentId = findParentId(next, id);
  if (parentId) {
    const parent = next.nodes[parentId];
    if (parent?.children?.length) parent.children = parent.children.filter((cid) => cid !== id);
  }
  const ids = collectSubtreeIds(next, id);
  for (const nid of ids) {
    delete next.nodes[nid];
  }
  return next;
}

export function duplicateNode(doc: MigraDoc, id: NodeId): { doc: MigraDoc; id: NodeId } {
  if (!id || id === doc.rootId) return { doc, id: '' };

  const parentId = findParentId(doc, id);
  if (!parentId) return { doc, id: '' };

  const next = safeClone(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc, id: '' };

  const mapping = new Map<NodeId, NodeId>();
  const subtree = collectSubtreeIds(next, id);
  for (const oldId of subtree) {
    mapping.set(oldId, makeId('n'));
  }

  for (const oldId of subtree) {
    const node = next.nodes[oldId];
    if (!node) continue;
    const newId = mapping.get(oldId)!;
    next.nodes[newId] = {
      id: newId,
      type: node.type,
      props: safeClone(node.props || {}),
      children: (node.children || []).map((cid) => mapping.get(cid)!).filter(Boolean),
    };
  }

  const insertAfterIndex = Math.max(0, parent.children.indexOf(id));
  const rootCloneId = mapping.get(id)!;
  parent.children = [
    ...parent.children.slice(0, insertAfterIndex + 1),
    rootCloneId,
    ...parent.children.slice(insertAfterIndex + 1),
  ];

  return { doc: next, id: rootCloneId };
}

export function wrapNode(
  doc: MigraDoc,
  id: NodeId,
  wrapperType: string,
  wrapperProps: Record<string, any> = {},
): { doc: MigraDoc; id: NodeId } {
  if (!id || id === doc.rootId) return { doc, id: '' };

  const parentId = findParentId(doc, id);
  if (!parentId) return { doc, id: '' };

  const next = safeClone(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc, id: '' };

  const idx = parent.children.indexOf(id);
  if (idx < 0) return { doc, id: '' };

  const wrapperId = makeId('n');
  next.nodes[wrapperId] = {
    id: wrapperId,
    type: wrapperType,
    props: safeClone(wrapperProps || {}),
    children: [id],
  };

  parent.children = [...parent.children.slice(0, idx), wrapperId, ...parent.children.slice(idx + 1)];
  return { doc: next, id: wrapperId };
}

export function unwrapNode(doc: MigraDoc, wrapperId: NodeId): { doc: MigraDoc; id: NodeId } {
  if (!wrapperId || wrapperId === doc.rootId) return { doc, id: '' };
  const wrapper = doc.nodes[wrapperId];
  if (!wrapper || !Array.isArray(wrapper.children) || wrapper.children.length !== 1) return { doc, id: '' };

  const childId = wrapper.children[0];
  const parentId = findParentId(doc, wrapperId);
  if (!parentId) return { doc, id: '' };

  const next = safeClone(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc, id: '' };

  const idx = parent.children.indexOf(wrapperId);
  if (idx < 0) return { doc, id: '' };

  parent.children = [...parent.children.slice(0, idx), childId, ...parent.children.slice(idx + 1)];
  delete next.nodes[wrapperId];
  return { doc: next, id: childId };
}
