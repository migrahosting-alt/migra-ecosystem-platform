// Engine approval sequence for applying a stored changeset — factored into a
// vscode-free module so it is unit-testable under `node --test`. The UI layer
// (proposedChangeset.ts) confirms with the user first, then calls this.
//
// Contract (mirrors the engine's tool-execute boundary): the approval-less call
// mints a single-use token bound to the exact proposal; the confirmed call
// consumes it to apply exactly once (replay-refused server-side).

/** Minimal shape of the tool-execute result the approval sequence inspects.
 *
 * `reason` and `error` are the engine's STRUCTURED refusal — a stable code plus a message
 * the engine already vetted as safe to show. They are optional because an older engine
 * simply will not send them; a caller must degrade to "not applied", never invent a cause. */
export type ExecResult = { status: string; approvalId?: string; reason?: string; error?: string };
export type ExecFn = (req: { tool: string; input: unknown; approvalId?: string }) => Promise<ExecResult>;

/** The outcome plus, when the engine supplied one, WHY it refused. */
export interface ChangesetApplyOutcome {
  applied: boolean;
  /** Stable machine-readable reason, e.g. STALE_CONTENT. Absent on older engines. */
  reason?: string;
  /** Engine-vetted, user-safe message. Absent on older engines. */
  message?: string;
}

/** Apply a stored changeset by hash through the engine's approval boundary, keeping the
 * engine's structured refusal. Never writes files itself — the engine owns the mutation;
 * this only orchestrates the two-call mint→consume handshake. */
export async function applyApprovedChangesetDetailed(
  execute: ExecFn,
  rootPath: string,
  proposalHash: string,
): Promise<ChangesetApplyOutcome> {
  const input = { rootPath, proposalHash };
  const refusal = (r: ExecResult): ChangesetApplyOutcome => ({
    applied: false,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.error ? { message: r.error } : {}),
  });
  const minted = await execute({ tool: 'fs.applyChangeset', input });
  // Some deployments may not gate this proposal — an immediate apply counts as done.
  if (minted.status === 'executed' || minted.status === 'ok') return { applied: true };
  if (minted.status !== 'approval_required' || !minted.approvalId) return refusal(minted);
  const applied = await execute({ tool: 'fs.applyChangeset', input, approvalId: minted.approvalId });
  return applied.status === 'executed' || applied.status === 'ok' ? { applied: true } : refusal(applied);
}

/** Back-compatible wrapper. Existing callers keep the exact shape they had. */
export async function applyApprovedChangeset(
  execute: ExecFn,
  rootPath: string,
  proposalHash: string,
): Promise<'applied' | 'not_applied'> {
  const outcome = await applyApprovedChangesetDetailed(execute, rootPath, proposalHash);
  return outcome.applied ? 'applied' : 'not_applied';
}
