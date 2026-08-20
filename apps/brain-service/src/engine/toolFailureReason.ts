// Structured refusal reasons for governed tool failures.
//
// THE PROBLEM THIS SOLVES
// ----------------------
// The engine already knows exactly why it refused — `ChangesetError('STALE', …)`,
// `WorkspaceToolError('PATH_ESCAPE', …)` — but `failed()` collapsed all of it into
// "The tool could not complete." The safety property was intact and the diagnosis was
// useless: a user could not tell "someone edited that file under me" from "that path
// escapes the workspace" from "the write rolled back".
//
// WHAT IS AND IS NOT ALLOWED OUT
// ------------------------------
// The raw `error.message` is NEVER forwarded. Those strings interpolate absolute paths,
// proposal hashes and internal stage names, and the previous generic message existed
// precisely to keep them in. What crosses instead is:
//
//   * a STABLE machine-readable `reason` a client can branch on, and
//   * a SAFE message written here, not by the throw site.
//
// `ChangesetError.details` is forwarded because its own contract says it carries "safe,
// bounded counts for audit/incident (never paths or content)". Stack traces, reverse
// material and raw messages are not forwarded under any branch.
//
// Adding a reason never changes WHETHER something is refused — only how the refusal is
// described. Every gate keeps its existing decision.

/** Stable, machine-readable refusal reasons. Clients branch on these, never on prose. */
export type ToolFailureReason =
  | 'STALE_CONTENT'
  | 'PATH_NOT_CONTAINED'
  | 'ROLLED_BACK'
  | 'INCONSISTENT_STATE'
  | 'CONFLICTING_EDITS'
  | 'PROPOSAL_EXPIRED'
  | 'OPERATION_NOT_PERMITTED'
  | 'TOO_LARGE'
  | 'TARGET_MISSING'
  | 'TARGET_EXISTS'
  | 'UNSUPPORTED_TARGET'
  | 'INVALID_REQUEST'
  | 'TIMEOUT'
  | 'CAPABILITY_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'INTERNAL_ERROR';

export interface ToolFailureClassification {
  readonly reason: ToolFailureReason;
  /** Safe, user-facing. Written here — never the throw site's message. */
  readonly message: string;
  /** Bounded counts only, when the underlying error carries them. */
  readonly details?: {
    appliedFileCount: number;
    affectedPathCount: number;
    rollbackFailureCount: number;
    failureStage: string;
  };
}

const MESSAGES: Readonly<Record<ToolFailureReason, string>> = {
  STALE_CONTENT:
    'A file changed after the change was proposed, so it was not applied. Re-run the request against the current contents.',
  PATH_NOT_CONTAINED:
    'The change targets a path outside the workspace root and was refused. Nothing was written.',
  ROLLED_BACK:
    'The change could not be completed and was rolled back. The workspace is unchanged — no file was partially written.',
  INCONSISTENT_STATE:
    'The change failed and the rollback did not fully succeed. Inspect the workspace before retrying.',
  CONFLICTING_EDITS:
    'The request contains conflicting edits to the same file and was refused. Nothing was written.',
  PROPOSAL_EXPIRED:
    'That proposal is no longer live — it expired, was already applied, or is unknown. Propose the change again.',
  OPERATION_NOT_PERMITTED: 'That operation is not permitted under the current policy.',
  TOO_LARGE: 'The change exceeds the size limits for this operation and was refused.',
  TARGET_MISSING: 'A file the change depends on does not exist.',
  TARGET_EXISTS: 'A file the change would create already exists.',
  UNSUPPORTED_TARGET: 'That file type is not supported by this operation.',
  INVALID_REQUEST: 'The request was not valid for this operation.',
  TIMEOUT: 'The operation exceeded its time limit and was stopped.',
  CAPABILITY_DENIED: 'That capability is not available on this path.',
  APPROVAL_REQUIRED: 'This operation needs an approval that is missing or has expired.',
  INTERNAL_ERROR: 'The tool could not complete.',
};

/** Engine error code -> stable reason. Anything unmapped stays INTERNAL_ERROR. */
const CODE_TO_REASON: Readonly<Record<string, ToolFailureReason>> = {
  // ChangesetError
  STALE: 'STALE_CONTENT',
  PARTIAL_WRITE: 'ROLLED_BACK',
  INCONSISTENT_STATE: 'INCONSISTENT_STATE',
  CONFLICT: 'CONFLICTING_EDITS',
  UNKNOWN_PROPOSAL: 'PROPOSAL_EXPIRED',
  DELETE_NOT_ALLOWED: 'OPERATION_NOT_PERMITTED',
  TOO_LARGE: 'TOO_LARGE',
  ALREADY_EXISTS: 'TARGET_EXISTS',
  NOT_FOUND: 'TARGET_MISSING',
  INVALID_INPUT: 'INVALID_REQUEST',
  // WorkspaceToolError
  PATH_ESCAPE: 'PATH_NOT_CONTAINED',
  ABSOLUTE_PATH: 'PATH_NOT_CONTAINED',
  INVALID_RANGE: 'INVALID_REQUEST',
  // A read-back mismatch means the bytes on disk are not what was intended; the engine
  // rolls back, so the user-visible truth is the same as any other rollback.
  READBACK_MISMATCH: 'ROLLED_BACK',
  // CommandPolicyError and friends
  UNSUPPORTED: 'OPERATION_NOT_PERMITTED',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** The bounded counts, only when they match the documented safe shape. */
function safeDetails(error: unknown): ToolFailureClassification['details'] {
  if (!isRecord(error) || !isRecord(error['details'])) return undefined;
  const d = error['details'];
  const numbers = ['appliedFileCount', 'affectedPathCount', 'rollbackFailureCount'] as const;
  if (!numbers.every((k) => typeof d[k] === 'number')) return undefined;
  if (typeof d['failureStage'] !== 'string') return undefined;
  return {
    appliedFileCount: d['appliedFileCount'] as number,
    affectedPathCount: d['affectedPathCount'] as number,
    rollbackFailureCount: d['rollbackFailureCount'] as number,
    failureStage: d['failureStage'] as string,
  };
}

/**
 * Classify an engine error into a stable reason and a safe message.
 *
 * Reads only the structured `code` and the documented-safe `details`. The error's own
 * message and stack never reach the client.
 */
export function classifyToolFailure(error: unknown): ToolFailureClassification {
  let reason: ToolFailureReason = 'INTERNAL_ERROR';

  if (isRecord(error)) {
    const code = typeof error['code'] === 'string' ? error['code'] : undefined;
    const name = typeof error['name'] === 'string' ? error['name'] : '';
    if (code !== undefined && CODE_TO_REASON[code] !== undefined) {
      reason = CODE_TO_REASON[code] as ToolFailureReason;
    } else if (name === 'AbortError' || code === 'ETIMEDOUT') {
      reason = 'TIMEOUT';
    }
  }

  const details = reason === 'ROLLED_BACK' || reason === 'INCONSISTENT_STATE' ? safeDetails(error) : undefined;
  return details === undefined
    ? { reason, message: MESSAGES[reason] }
    : { reason, message: MESSAGES[reason], details };
}
