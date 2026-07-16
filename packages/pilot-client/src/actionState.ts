// Pending-action lifecycle state machine (P4). vscode-free and pure so the full
// transition matrix is unit-testable. The extension is a thin approver: it never
// reconstructs, edits, or re-plans an action — it only references server-issued
// identifiers and asks the server to transition state. This module is the
// client-side fail-closed guard; pilot-api remains the authority.

export type ActionState =
  | 'PENDING'
  | 'APPROVED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'REJECTED'
  | 'DENIED'
  | 'EXPIRED'
  | 'CONSUMED';

export type ActionOp = 'approve' | 'reject' | 'resume';

export const ACTION_STATES: readonly ActionState[] = [
  'PENDING',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'REJECTED',
  'DENIED',
  'EXPIRED',
  'CONSUMED',
];

/** States from which no further transition is permitted. */
export const TERMINAL_STATES: readonly ActionState[] = [
  'EXECUTED',
  'REJECTED',
  'DENIED',
  'EXPIRED',
  'CONSUMED',
];

export function isTerminal(state: ActionState): boolean {
  return TERMINAL_STATES.includes(state);
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; reason: 'INVALID_STATE' };

/**
 * Whether an operation is permitted from a given state.
 *  - approve / reject: only from PENDING.
 *  - resume: only from APPROVED (approved-but-not-yet-completed).
 * Everything else — including all terminal states and EXECUTING — is refused.
 * A duplicate op from its *already-applied* state (e.g. approve when APPROVED)
 * is NOT permitted here; idempotent replays are handled at the request layer via
 * the requestId idempotency key, not by relaxing the state machine.
 */
export function canApply(op: ActionOp, state: ActionState): TransitionCheck {
  switch (op) {
    case 'approve':
    case 'reject':
      return state === 'PENDING' ? { ok: true } : { ok: false, reason: 'INVALID_STATE' };
    case 'resume':
      return state === 'APPROVED' ? { ok: true } : { ok: false, reason: 'INVALID_STATE' };
  }
}

/** The state an op moves a PENDING/APPROVED action to on success (for modeling
 * and assertions). Execution completion (EXECUTING→EXECUTED) is server-driven. */
export function nextState(op: ActionOp): ActionState {
  switch (op) {
    case 'approve':
      return 'APPROVED';
    case 'reject':
      return 'REJECTED';
    case 'resume':
      return 'EXECUTING';
  }
}
