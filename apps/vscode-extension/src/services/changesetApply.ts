// Engine approval sequence for applying a stored changeset — factored into a
// vscode-free module so it is unit-testable under `node --test`. The UI layer
// (proposedChangeset.ts) confirms with the user first, then calls this.
//
// Contract (mirrors the engine's tool-execute boundary): the approval-less call
// mints a single-use token bound to the exact proposal; the confirmed call
// consumes it to apply exactly once (replay-refused server-side).

/** Minimal shape of the tool-execute result the approval sequence inspects. */
export type ExecResult = { status: string; approvalId?: string };
export type ExecFn = (req: { tool: string; input: unknown; approvalId?: string }) => Promise<ExecResult>;

/** Apply a stored changeset by hash through the engine's approval boundary.
 * Returns whether it was applied. Never writes files itself — the engine owns
 * the mutation; this only orchestrates the two-call mint→consume handshake. */
export async function applyApprovedChangeset(
  execute: ExecFn,
  rootPath: string,
  proposalHash: string,
): Promise<'applied' | 'not_applied'> {
  const input = { rootPath, proposalHash };
  const minted = await execute({ tool: 'fs.applyChangeset', input });
  // Some deployments may not gate this proposal — an immediate apply counts as done.
  if (minted.status === 'executed' || minted.status === 'ok') return 'applied';
  if (minted.status !== 'approval_required' || !minted.approvalId) return 'not_applied';
  const applied = await execute({ tool: 'fs.applyChangeset', input, approvalId: minted.approvalId });
  return applied.status === 'executed' || applied.status === 'ok' ? 'applied' : 'not_applied';
}
