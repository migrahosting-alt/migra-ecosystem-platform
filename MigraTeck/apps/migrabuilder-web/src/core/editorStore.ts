import type { MigraDoc } from './document';
import type { NodeId } from './document';

export interface LockState {
  mode: 'none' | 'full' | 'structure';
  inherited: boolean;
  lockingAncestorId: NodeId | null;
}

/** Minimal interface for the store injected as 'migraStore' */
export interface EditorStore {
  doc: MigraDoc;
  getEffectiveLockState(nodeId: NodeId): LockState;
  isNodeHidden(nodeId: NodeId): boolean;
  isStructureLocked(nodeId: NodeId): boolean;
  isEditLocked(nodeId: NodeId): boolean;
  getNodeTitle(nodeId: NodeId): string;
  getAncestorChain(nodeId: NodeId): NodeId[];
  getOwnLockMode(nodeId: NodeId): 'none' | 'full' | 'structure';
  getChildIds?(nodeId: NodeId): NodeId[];
  patchNodesProps(ids: NodeId[], props: Record<string, unknown>, source: string): void;
  select(nodeId: NodeId): void;
  selectSingle(nodeId: NodeId): void;
  toggleSelect(nodeId: NodeId): void;
}
