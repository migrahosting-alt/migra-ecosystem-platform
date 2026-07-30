/**
 * Proposed-edit types (MigraPilot Phase C, extension side).
 *
 * A proposal is the ONLY thing that can lead to a file write. It is produced by a
 * strict typed tool result (never plain model text), persisted + authorized by
 * pilot-api, reviewed as a native diff, approved by the user, and applied through
 * the trusted VS Code WorkspaceEdit boundary.
 */

export type EditOperation = "create" | "modify" | "delete" | "rename";
export type RiskClass = "LOW" | "MEDIUM" | "HIGH";

/** Full lifecycle the review UI can render (mission §4). */
export type ProposalStatus =
  | "received" | "reviewing" | "approved" | "rejected" | "stale" | "blocked"
  | "applying" | "applied" | "partially_applied" | "rollback_available"
  | "rolled_back" | "failed" | "expired";

export interface ProposalFile {
  path: string;                 // workspace-relative POSIX path
  operation: EditOperation;
  renameTo?: string | null;     // destination for rename
  originalHash?: string | null; // sha256 of pre-edit content (modify|delete|rename)
  proposedHash?: string | null; // sha256 of proposed content (create|modify)
  proposedContent?: string | null; // null when withheld (sensitive)
  sensitive: boolean;
  riskClass: RiskClass;
  // populated after apply, used for rollback:
  preApplyContent?: string | null;
  postApplyHash?: string | null;
  applyState?: "pending" | "applied" | "failed" | "skipped" | "rolled_back";
}

export interface EditProposal {
  id: string;
  workspaceId: string;
  conversationId?: string | null;
  missionId?: string | null;
  taskId?: string | null;
  title: string;
  explanation: string;
  status: ProposalStatus;
  riskClass: RiskClass;
  dryRun: boolean;
  provider?: unknown;
  generatedAt?: string;
  expiresAt?: string;
  files: ProposalFile[];
}

/** The strict typed structure a tool result must have to become a proposal. */
export interface ProposedEditToolResult {
  kind: "proposed_edit";
  title: string;
  explanation: string;
  files: Array<{
    path: string;
    operation: EditOperation;
    renameTo?: string;
    originalContent?: string;  // used to derive originalHash
    proposedContent?: string;
  }>;
  provider?: unknown;
}

/** Live on-disk state the extension reports to the backend authorizer + uses locally. */
export interface FileLiveState { path: string; currentHash: string | null; dirty: boolean; exists: boolean }
export interface RollbackLiveState { path: string; currentHash: string | null; exists: boolean }

export interface ApplyFileResult {
  path: string;
  applyState: "applied" | "failed" | "skipped";
  preApplyContent?: string | null;
  postApplyHash?: string | null;
  error?: string;
}
export interface ApplyOutcome {
  ok: boolean;
  blocked: boolean;
  outcome: "applied" | "partial" | "failed" | "blocked";
  reasons: string[];
  results: ApplyFileResult[];
}

export interface RollbackPlanItem {
  path: string;
  operation: EditOperation;
  renameTo?: string | null;
  preApplyContent?: string | null;
  postApplyHash?: string | null;
}
export interface RollbackOutcome {
  ok: boolean;
  blocked: boolean;
  reasons: string[];
  results: Array<{ path: string; state: "restored" | "removed" | "failed" | "skipped" }>;
}
