/**
 * Wire mirrors of the Brain's contracts.
 *
 * LIFTED VERBATIM, NOT RE-AUTHORED, from the canonical typed client at
 * `apps/vscode-extension/src/services/codingRunClient.ts`. That file is the
 * de-facto contract package today — `MigraTeck/packages/api-contracts` covers
 * auth/org/security only and has no Brain DTOs.
 *
 * When a shared `packages/coding-client` is extracted (see
 * src/server/brain/REUSE.md), this file is deleted and imported from there
 * instead. Do not let the two drift in the meantime.
 *
 * Note what is absent, deliberately: there is no percentage, no elapsed-time
 * progress, no validation tally, and no per-file line delta anywhere in these
 * types, because none exist in the contract. UI must not invent them.
 */

export interface CodingRunChildView {
  childId: string
  kind: string
  attempt: number
  state: string
  required: boolean
  terminalCategory?: string
}

export interface CodingScopeView {
  proposedPaths: string[]
  pathSetHash: string
  approvalState: string
  approvalExpiresAt: string
  proposedAt: string
  approvedAt?: string
  /** Line ranges and hashes only — never file contents. */
  evidence: Array<{ path: string; spans: Array<{ startLine: number; endLine: number; excerptHash: string }> }>
  rationales: Array<{ path: string; rationale: string }>
  /** Server-decided exclusions. There is no per-file user consent in this contract. */
  excluded: Array<{ path: string; reason: string }>
}

export interface CodingRunSnapshot {
  runId: string
  /** The Brain's own change counter. The only honest trigger for a re-render. */
  revision: number
  state: string
  phase: string
  issueSummary?: string
  scope?: CodingScopeView
  children: CodingRunChildView[]
  cancellation?: { requestedAt: string; confirmedAt?: string; status: 'cancelling' | 'cancelled' }
  latestValidation?: {
    commandRunId: string
    command: string[]
    exitCode: number | null
    timedOut: boolean
    passed: boolean
    outputHead: string
  }
  blockers: string[]
  finalReport?: {
    stopReason: string
    complete: boolean
    changedFiles: string[]
    approvedPaths: string[]
    refusedPaths: string[]
    unusedScope: string[]
    unresolvedRisks: string[]
  }
  statusUrl: string
}

export interface GovernedCodingCapability {
  available: boolean
  approvalMode: 'scope'
  progressMode: 'polling'
  workspaceRootsConfigured: number
  unavailableReason?: string
}

/** `GET /api/ai/conversations` → `{ conversations: [...] }`. */
export interface ConversationSummary {
  id: string
  title?: string
  memoryMode?: 'off' | 'session' | 'durable'
  /** Files this conversation answers from. Absent or empty means ungrounded. */
  groundingFiles?: string[]
  /**
   * Content-addressed image refs this conversation is currently about.
   *
   * Separate from `groundingFiles`: those are searchable documents, these drive
   * vision, and they reconcile against different stores. Refs only — the bytes
   * are transport for a single turn.
   */
  imageRefs?: string[]
  createdAt?: string | number
  updatedAt?: string | number
}

export interface ConversationMessage {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt?: string | number
}
