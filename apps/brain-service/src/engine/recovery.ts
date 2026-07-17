// Workspace recovery workflow (Operational Readiness Slice 4).
//
// When an application leaves the workspace in a PARTIAL_WRITE or INCONSISTENT_STATE,
// recovery builds an APPROVAL-GATED restoration from server-side reverse material
// and applies it through the SAME contained/atomic changeset engine — never a
// bypass around fs.applyChangeset, never a "force repair". Every step is
// correlated and audited (recovery.*), linked to the original incident +
// execution. Incidents resolve only with validation evidence.
//
// © MigraTeck LLC.

import { randomUUID } from 'node:crypto';
import { auditStore, auditHash } from './auditLog.js';
import { newCorrelationId } from './correlation.js';
import { incidentManager, type IncidentManager } from './incidents.js';
import { ChangesetProposalStore, proposeChangeset, applyChangeset, type ChangesetFs } from '../tools/changeset.js';
import type { ChangeOp, ChangesetRequest } from '@migrapilot/protocol';

export interface ReverseEntry {
  path: string;
  /** Prior content to restore (null = the file was newly created → delete it). */
  previousContent: string | null;
}

interface StashRecord {
  rootPath: string;
  entries: ReverseEntry[];
  originalCorrelationId: string;
  incidentId?: string;
}

export interface RecoveryPlan {
  recoveryId: string;
  recoveryCorrelationId: string;
  originalCorrelationId: string;
  incidentId?: string;
  /** Restoration ops (metadata-safe view — no content). */
  opsSummary: Array<{ op: string; kind: 'restore' | 'remove' }>;
  fileCount: number;
  /** Single-use approval required to apply this recovery. */
  approvalToken: string;
  createdAt: number;
}

interface RecoveryBundle extends RecoveryPlan {
  changeset: ChangesetRequest;
  approvalUsed: boolean;
}

/** Build restoration ops from reverse material: files that previously existed
 * are replaced with their prior content; files that were newly created are
 * deleted (with allowDelete). */
function restorationChangeset(rootPath: string, entries: ReverseEntry[]): ChangesetRequest {
  const ops: ChangeOp[] = entries.map((e) =>
    e.previousContent === null ? ({ op: 'delete', path: e.path } as ChangeOp) : ({ op: 'replace', path: e.path, content: e.previousContent } as ChangeOp),
  );
  const needsDelete = entries.some((e) => e.previousContent === null);
  return { rootPath, ops, ...(needsDelete ? { allowDelete: true } : {}) };
}

export class RecoveryManager {
  private readonly stashed = new Map<string, StashRecord>(); // key = originalCorrelationId
  private readonly bundles = new Map<string, RecoveryBundle>(); // recoveryId

  constructor(
    private readonly incidents: IncidentManager = incidentManager,
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
  ) {}

  /** Called by the apply boundary on a failed application so recovery has the
   * authoritative reverse material. Content lives ONLY here — never audited. */
  stashReverseMaterial(originalCorrelationId: string, rootPath: string, entries: ReverseEntry[], incidentId?: string): void {
    this.stashed.set(originalCorrelationId, { rootPath, entries, originalCorrelationId, incidentId });
  }

  /** PLAN — read-only. Builds an approval-gated restoration; ZERO writes. */
  plan(originalCorrelationId: string): RecoveryPlan {
    const stash = this.stashed.get(originalCorrelationId);
    if (!stash) throw new RecoveryError('NO_REVERSE_MATERIAL', 'no recovery material for that correlation');
    const recoveryId = this.mkId();
    const recoveryCorrelationId = newCorrelationId(this.now);
    const changeset = restorationChangeset(stash.rootPath, stash.entries);
    const approvalToken = `rec_${this.mkId()}`;
    // recovery.started + plan_created — linked to the ORIGINAL execution + incident.
    auditStore.append({ correlationId: recoveryCorrelationId, type: 'recovery.started', component: 'recovery', causationId: null, fields: { origin: auditHash(originalCorrelationId), incident: stash.incidentId ?? 'none', workspace: auditHash(stash.rootPath) } });
    auditStore.append({ correlationId: recoveryCorrelationId, type: 'recovery.plan_created', component: 'recovery', fields: { fileCount: changeset.ops.length, workspace: auditHash(stash.rootPath) } });
    const plan: RecoveryBundle = {
      recoveryId,
      recoveryCorrelationId,
      originalCorrelationId,
      incidentId: stash.incidentId,
      opsSummary: changeset.ops.map((o) => ({ op: o.op, kind: o.op === 'delete' ? 'remove' : 'restore' })),
      fileCount: changeset.ops.length,
      approvalToken,
      createdAt: this.now(),
      changeset,
      approvalUsed: false,
    };
    this.bundles.set(recoveryId, plan);
    return { ...plan, changeset: undefined } as unknown as RecoveryPlan;
  }

  /** The changeset to actually apply, resolved against the CURRENT workspace: a
   * reverse-material "delete" (a file that was to be newly created) is dropped
   * when that file does not currently exist — e.g. an INCONSISTENT_STATE where
   * the create's write faulted, so the file was never written. Deleting an
   * absent file would fail the all-or-nothing engine; the goal (file absent) is
   * already met. Mirrors the engine's own tolerant undo(). Never adds writes. */
  private effective(b: RecoveryBundle, fs: ChangesetFs): ChangesetRequest {
    const ops = b.changeset.ops.filter((o) => o.op !== 'delete' || fs.exists(fs.resolve(b.changeset.rootPath, o.path)));
    const needsDelete = ops.some((o) => o.op === 'delete');
    return { rootPath: b.changeset.rootPath, ops, ...(needsDelete ? { allowDelete: true } : {}) };
  }

  /** SIMULATE — read-only preview of what a recovery WOULD write. Zero writes. */
  simulate(recoveryId: string, fs: ChangesetFs): { fileCount: number; wouldRestore: number; wouldRemove: number } {
    const b = this.bundles.get(recoveryId);
    if (!b) throw new RecoveryError('UNKNOWN_RECOVERY', 'unknown recovery id');
    const changeset = this.effective(b, fs);
    // Dry-run through the changeset previewer (never mutates).
    const store = new ChangesetProposalStore(this.now);
    proposeChangeset(changeset, fs, store, b.recoveryCorrelationId);
    return {
      fileCount: changeset.ops.length,
      wouldRestore: changeset.ops.filter((o) => o.op !== 'delete').length,
      wouldRemove: changeset.ops.filter((o) => o.op === 'delete').length,
    };
  }

  /** APPLY — explicit, single-use approval-gated, through the contained atomic
   * changeset engine (NOT a bypass). Replay is refused. */
  apply(recoveryId: string, approvalToken: string, fs: ChangesetFs): { created: string[]; modified: string[]; deleted: string[] } {
    const b = this.bundles.get(recoveryId);
    if (!b) throw new RecoveryError('UNKNOWN_RECOVERY', 'unknown recovery id');
    if (b.approvalToken !== approvalToken) throw new RecoveryError('APPROVAL_MISMATCH', 'recovery approval does not match');
    if (b.approvalUsed) throw new RecoveryError('APPROVAL_REPLAYED', 'recovery approval already used');
    b.approvalUsed = true; // single-use
    auditStore.append({ correlationId: b.recoveryCorrelationId, type: 'recovery.approved', component: 'recovery', fields: { fileCount: b.fileCount } });
    // Apply through the standard changeset engine: propose (stores) → apply by
    // hash. Containment + atomic write + rollback are enforced there.
    const changeset = this.effective(b, fs);
    const store = new ChangesetProposalStore(this.now);
    const proposal = proposeChangeset(changeset, fs, store, b.recoveryCorrelationId);
    try {
      const res = applyChangeset({ rootPath: changeset.rootPath, proposalHash: proposal.proposalHash }, fs, store, b.recoveryCorrelationId);
      auditStore.append({ correlationId: b.recoveryCorrelationId, type: 'recovery.applied', component: 'recovery', outcome: 'ok', fields: { created: res.created.length, modified: res.modified.length, deleted: res.deleted.length } });
      return { created: res.created, modified: res.modified, deleted: res.deleted };
    } catch (err) {
      auditStore.append({ correlationId: b.recoveryCorrelationId, type: 'recovery.failed', component: 'recovery', outcome: 'error', fields: {} });
      throw err;
    }
  }

  /** VERIFY — integrity check that restored files now match the expected prior
   * content. Produces the validation evidence required to resolve the incident. */
  verify(recoveryId: string, fs: ChangesetFs): { ok: boolean; checked: number; recoveryCorrelationId: string } {
    const b = this.bundles.get(recoveryId);
    if (!b) throw new RecoveryError('UNKNOWN_RECOVERY', 'unknown recovery id');
    const stash = this.stashed.get(b.originalCorrelationId)!;
    let ok = true;
    let checked = 0;
    for (const e of stash.entries) {
      checked += 1;
      const abs = fs.resolve(stash.rootPath, e.path);
      if (e.previousContent === null) {
        if (fs.exists(abs)) ok = false; // should have been removed
      } else {
        if (!fs.exists(abs) || fs.readFile(abs) !== e.previousContent) ok = false;
      }
    }
    auditStore.append({ correlationId: b.recoveryCorrelationId, type: 'recovery.validation_completed', component: 'recovery', outcome: ok ? 'ok' : 'mismatch', fields: { checked, ok } });
    return { ok, checked, recoveryCorrelationId: b.recoveryCorrelationId };
  }

  /** RESOLVE — require validation evidence; link the recovery to the incident;
   * emit recovery.completed. Refuses to resolve without evidence. */
  resolve(recoveryId: string, evidence: { ok: boolean; checked: number }): void {
    const b = this.bundles.get(recoveryId);
    if (!b) throw new RecoveryError('UNKNOWN_RECOVERY', 'unknown recovery id');
    if (!evidence || evidence.ok !== true || evidence.checked < 1) {
      throw new RecoveryError('NO_VALIDATION_EVIDENCE', 'incident cannot resolve without passing validation evidence');
    }
    if (b.incidentId) {
      this.incidents.resolveWithEvidence(b.incidentId, {
        recoveryCorrelationId: b.recoveryCorrelationId,
        validationEvidence: { checked: evidence.checked, ok: evidence.ok },
        note: 'recovery applied + validated',
      });
    }
    auditStore.append({ correlationId: b.recoveryCorrelationId, type: 'recovery.completed', component: 'recovery', outcome: 'ok', fields: { incident: b.incidentId ?? 'none' } });
  }

  get(recoveryId: string): RecoveryBundle | undefined {
    return this.bundles.get(recoveryId);
  }
}

export class RecoveryError extends Error {
  constructor(readonly code: 'NO_REVERSE_MATERIAL' | 'UNKNOWN_RECOVERY' | 'APPROVAL_MISMATCH' | 'APPROVAL_REPLAYED' | 'NO_VALIDATION_EVIDENCE', message: string) {
    super(message);
    this.name = 'RecoveryError';
  }
}

export const recoveryManager = new RecoveryManager();
