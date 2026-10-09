import { randomUUID } from 'node:crypto';
import {
  ChangesetError,
  ChangesetProposalStore,
  ToolApprovalStore,
  applyChangeset,
  editApply,
  hashInput,
  nodeChangesetFs,
  previewStoredChangeset,
  proposeChangeset,
  type ChangesetFs,
} from '@migrapilot/workspace-tools';
import { ApplyChangesetRequestSchema, EditApplyRequestSchema, type ProposeChangesetResponse } from '@migrapilot/protocol';

export interface WorkspaceToolRequest {
  tool: string;
  input: unknown;
  dryRun?: boolean;
  approvalId?: string;
}

export type WorkspaceToolResult =
  | { status: 'ok'; tool: string; result: unknown; requestId: string }
  | { status: 'dry_run'; tool: string; preview: unknown; requestId: string }
  | { status: 'approval_required'; tool: string; approvalId: string; preview: unknown; expiresAt: number; requestId: string }
  | { status: 'executed'; tool: string; result: unknown; approvalId?: string; requestId: string };

export interface WorkspaceExecutionOptions {
  signal?: AbortSignal;
  requestId?: string;
  /** Trusted native UI context, never populated from a tool request body. */
  operatorConfirmed?: boolean;
}

export interface WorkspaceMutationDeps {
  fs?: ChangesetFs;
  proposals?: ChangesetProposalStore;
  approvals?: ToolApprovalStore;
  now?: () => number;
}

export class WorkspaceToolError extends Error {
  constructor(message: string, readonly code: 'INVALID_INPUT' | 'INVALID_STATE' | 'CANCELLED' = 'INVALID_INPUT') {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}

type ApprovalHost = {
  requestApproval(summary: { tool: string; fileCount: number; paths: string[] }): Promise<boolean>;
  assertCanApply?(rootPath: string, paths: string[]): void;
};

export function createWorkspaceMutationExecutor(host: ApprovalHost, deps: WorkspaceMutationDeps = {}) {
  const now = deps.now ?? Date.now;
  const fs = deps.fs ?? nodeChangesetFs();
  const proposals = deps.proposals ?? new ChangesetProposalStore(now);
  const approvals = deps.approvals ?? new ToolApprovalStore(now);
  const pending = new Map<string, { proposal: ProposeChangesetResponse; inputHash: string; tool: string }>();
  const checkCancelled = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new WorkspaceToolError('Workspace tool execution cancelled.', 'CANCELLED');
  };
  const requestApproval = async (summary: Parameters<ApprovalHost['requestApproval']>[0], signal?: AbortSignal) => {
    if (!signal) return host.requestApproval(summary);
    let onAbort = () => {};
    try {
      return await Promise.race([
        host.requestApproval(summary),
        new Promise<boolean>((_, reject) => {
          onAbort = () => reject(new WorkspaceToolError('Workspace tool execution cancelled.', 'CANCELLED'));
          if (signal.aborted) onAbort();
          else signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
  const sweep = () => {
    for (const id of pending.keys()) {
      const record = approvals.get(id);
      if (!record || record.state !== 'PENDING' || record.expiresAt <= now()) pending.delete(id);
    }
  };
  const previewEdits = (input: unknown) => {
    const request = EditApplyRequestSchema.parse(input);
    const preview = editApply(request, { fs, mode: 'dry-run' });
    return { tool: 'edit.preview' as const, files: preview.files.map(({ path, before, after }) => {
      if (typeof before !== 'string' || typeof after !== 'string') throw new WorkspaceToolError('Edit preview omitted exact file contents.');
      return { path, before, after };
    }) };
  };

  return {
    propose: (input: unknown) => proposeChangeset(input, fs, proposals),
    previewEdits,
    async execute(request: WorkspaceToolRequest, options: WorkspaceExecutionOptions = {}): Promise<WorkspaceToolResult> {
      checkCancelled(options.signal);
      sweep();
      const requestId = options.requestId ?? randomUUID();
      const inputHash = hashInput(request.input);
      const binding = { tool: request.tool, inputHash };
      let proposal: ProposeChangesetResponse;
      if (request.approvalId) {
        const entry = pending.get(request.approvalId);
        const record = approvals.get(request.approvalId);
        if (!entry || !record || record.state !== 'PENDING' || record.expiresAt <= now()
          || entry.tool !== request.tool || entry.inputHash !== inputHash) {
          throw new WorkspaceToolError('Approval is unknown, expired, consumed or bound to different input.', 'INVALID_STATE');
        }
        proposal = entry.proposal;
      } else if (request.tool === 'fs.applyChangeset') {
        const input = ApplyChangesetRequestSchema.strict().parse(request.input);
        proposal = previewStoredChangeset(input, fs, proposals);
        if (proposal.proposalHash !== input.proposalHash) {
          throw new ChangesetError('STALE', 'Workspace source changed since the proposal; build a new proposal.');
        }
      } else if (request.tool === 'edit.apply') {
        const input = EditApplyRequestSchema.parse(request.input);
        const preview = previewEdits(input);
        proposal = proposeChangeset({
          rootPath: input.rootPath,
          ops: preview.files.map(file => ({ op: 'replace', path: file.path, content: file.after })),
        }, fs, proposals);
      } else {
        throw new WorkspaceToolError(`${request.tool} is not a mutating workspace tool`);
      }

      const preview = request.tool === 'edit.apply'
        ? { tool: 'edit.preview', files: proposal.ops.map(op => ({ path: op.path, before: op.before, after: op.after })) }
        : proposal;
      if (request.dryRun) return { status: 'dry_run', tool: request.tool, preview, requestId };
      if (!request.approvalId) {
        const approval = approvals.mint({ ...binding, requestId });
        pending.set(approval.id, { proposal, inputHash, tool: request.tool });
        return { status: 'approval_required', tool: request.tool, approvalId: approval.id, preview, expiresAt: approval.expiresAt, requestId };
      }

      try {
        if (!options.operatorConfirmed) {
          const approved = await requestApproval({
            tool: request.tool,
            fileCount: proposal.fileCount,
            paths: proposal.ops.map(op => op.path),
          }, options.signal);
          checkCancelled(options.signal);
          if (!approved) throw new WorkspaceToolError('The operator did not approve this change.', 'CANCELLED');
        }
        checkCancelled(options.signal);
        host.assertCanApply?.(proposal.changeset.rootPath, proposal.ops.map(op => op.path));
        const consumed = approvals.consume(request.approvalId, binding);
        if (!consumed.ok) throw new WorkspaceToolError(`Approval refused: ${consumed.reason}.`, 'INVALID_STATE');
        pending.delete(request.approvalId);
        const applied = applyChangeset({ rootPath: proposal.changeset.rootPath, proposalHash: proposal.proposalHash }, fs, proposals);
        const result = request.tool === 'edit.apply'
          ? { tool: 'edit.apply', files: proposal.ops.map(op => ({ path: op.path, changed: op.before !== op.after })) }
          : applied;
        return { status: 'executed', tool: request.tool, result, approvalId: request.approvalId, requestId };
      } catch (error) {
        approvals.reject(request.approvalId, binding);
        pending.delete(request.approvalId);
        throw error;
      }
    },
  };
}
