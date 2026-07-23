import { createHash } from 'node:crypto';
import type { AgentModeRecoveryClass, AgentModeState } from '@migrapilot/protocol';
import type { DurableAgentRun, DurableAgentRunEvent, DurableAgentRunState } from './persistence/types.js';

export type RecoverySourceProvenanceCode =
  | 'TRUSTED'
  | 'SOURCE_NOT_TERMINAL'
  | 'SOURCE_WORKSPACE_MISMATCH'
  | 'SOURCE_RECIPE_DISABLED'
  | 'SOURCE_HAS_ACTIVE_SUCCESSOR'
  | 'SOURCE_UNDER_RECONCILIATION'
  | 'SOURCE_SCHEMA_INVALID'
  | 'SOURCE_METADATA_INCOMPLETE'
  | 'SOURCE_TERMINAL_REASON_INVALID'
  | 'SOURCE_TERMINAL_EVENT_INVALID'
  | 'SOURCE_EVENT_TYPE_UNSUPPORTED'
  | 'SOURCE_EVENT_CHAIN_IMPOSSIBLE'
  | 'SOURCE_RECOVERY_CONTRACT_MISSING'
  | 'SOURCE_INTEGRITY_SENSITIVE_FAILURE'
  | 'MISSING_REQUIRED_EVENT'
  | 'EVENT_SEQUENCE_GAP'
  | 'ILLEGAL_STATE_TRANSITION'
  | 'TERMINAL_STATE_MISMATCH'
  | 'AUDIT_SEQUENCE_MISMATCH'
  | 'APPROVAL_LIFECYCLE_MISMATCH'
  | 'SOURCE_INTEGRITY_FAILED';

export interface RecoverySourceProvenanceInput {
  run: DurableAgentRun;
  events: readonly DurableAgentRunEvent[];
  workspaceIdentity: string;
  allowedRecipes: readonly string[];
  now: number;
}

export interface RecoverySourceProvenanceResult {
  trusted: boolean;
  code: RecoverySourceProvenanceCode;
  explanation: string;
  recoveryClass: AgentModeRecoveryClass;
  eligible: boolean;
  highestSeq: number;
  digest: string;
}

type RecoverySourceProvenanceFailureCode = Exclude<RecoverySourceProvenanceCode, 'TRUSTED'>;

const TERMINAL = new Set<DurableAgentRunState>(['COMPLETED', 'REJECTED', 'EXPIRED', 'STALE', 'FAILED', 'CANCELLED']);
const RECOVERABLE = new Set<AgentModeRecoveryClass>(['REPROPOSAL_ALLOWED', 'REPROPOSAL_REQUIRED', 'SNAPSHOT_CHANGED']);
const RECIPES = new Set(['git.status', 'git.diff']);
const APPROVAL_LIFECYCLE = new Set(['NOT_REQUESTED', 'PENDING_DISPLAY', 'DISPLAYED', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'LOST_ON_RESTART', 'CONSUMED']);
const EVENT_SOURCES = new Set(['API', 'APPROVAL', 'EXECUTION', 'RECONCILIATION', 'SHUTDOWN', 'CLEANUP', 'RECOVERY']);
const EXECUTION_EVENTS = Object.freeze(['execution.start_requested', 'execution.spawned', 'execution.completed', 'execution.failed', 'containment.terminated', 'containment.termination_failed']);
const PROVENANCE_EVENT_TYPES = new Set([
  'run.created',
  'proposal.created',
  'approval.requested',
  'approval.displayed',
  'approval.rejected',
  'approval.approved',
  'approval.consumed',
  'approval.expired',
  'approval.lost_on_restart',
  'cancellation.requested',
  'execution.start_requested',
  'execution.spawned',
  'execution.completed',
  'execution.failed',
  'proposal.stale',
  'restart.reconciliation_started',
  'restart.authorization_lost',
  'restart.interrupted_execution',
  'containment.terminated',
  'containment.termination_failed',
  'shutdown.termination_requested',
  'recovery.reproposal_requested',
  'recovery.successor_linked',
]);

interface TerminalContract {
  readonly state: DurableAgentRunState;
  readonly reason: string;
  readonly finalEventTypes: readonly string[];
  readonly finalEventReasons?: readonly string[];
  readonly requiredEvents: readonly string[];
  readonly forbiddenEvents?: readonly string[];
  readonly allowedFinalPriorStates: readonly DurableAgentRunState[];
  readonly approvalLifecycle: DurableAgentRun['approvalLifecycle'];
  readonly approvalDecisionType?: DurableAgentRun['approvalDecisionType'];
  readonly executionRequired?: boolean;
  readonly executionForbidden?: boolean;
  readonly containmentRequired?: boolean;
  readonly containmentForbidden?: boolean;
  readonly recoveryClass: AgentModeRecoveryClass;
  readonly recoverable: boolean;
  readonly integritySensitive?: boolean;
}

const CONTRACTS: readonly TerminalContract[] = Object.freeze([
  contract({ state: 'REJECTED', reason: 'REJECTED', finalEventTypes: ['approval.rejected'], finalEventReasons: ['HUMAN_REJECTED'], requiredEvents: ['approval.rejected'], forbiddenEvents: EXECUTION_EVENTS, allowedFinalPriorStates: ['AWAITING_APPROVAL'], approvalLifecycle: 'REJECTED', approvalDecisionType: 'REJECTED', executionForbidden: true, containmentForbidden: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'EXPIRED', reason: 'EXPIRED', finalEventTypes: ['approval.expired'], finalEventReasons: ['APPROVAL_TTL_EXPIRED'], requiredEvents: ['approval.expired'], forbiddenEvents: EXECUTION_EVENTS, allowedFinalPriorStates: ['AWAITING_APPROVAL'], approvalLifecycle: 'EXPIRED', executionForbidden: true, containmentForbidden: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'EXPIRED', reason: 'RESTART_AUTHORIZATION_LOST', finalEventTypes: ['approval.lost_on_restart'], requiredEvents: ['approval.lost_on_restart'], forbiddenEvents: EXECUTION_EVENTS, allowedFinalPriorStates: ['AWAITING_APPROVAL'], approvalLifecycle: 'LOST_ON_RESTART', executionForbidden: true, containmentForbidden: true, recoveryClass: 'REPROPOSAL_REQUIRED', recoverable: true }),
  contract({ state: 'STALE', reason: 'STALE', finalEventTypes: ['proposal.stale'], finalEventReasons: ['STALE_PROPOSAL'], requiredEvents: ['proposal.stale'], forbiddenEvents: ['execution.start_requested', 'execution.spawned', 'execution.completed', 'execution.failed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['AWAITING_APPROVAL', 'APPROVED'], approvalLifecycle: 'INVALIDATED', executionForbidden: true, containmentForbidden: true, recoveryClass: 'SNAPSHOT_CHANGED', recoverable: true }),
  contract({ state: 'STALE', reason: 'RESTART_BEFORE_EXECUTION', finalEventTypes: ['restart.authorization_lost'], requiredEvents: ['approval.approved', 'restart.authorization_lost'], forbiddenEvents: ['execution.start_requested', 'execution.spawned', 'execution.completed', 'execution.failed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['APPROVED'], approvalLifecycle: 'INVALIDATED', executionForbidden: true, containmentForbidden: true, recoveryClass: 'REPROPOSAL_REQUIRED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'INTERRUPTED_BY_RESTART', finalEventTypes: ['restart.interrupted_execution'], requiredEvents: ['execution.start_requested', 'restart.interrupted_execution'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'RESTART_NO_CONTAINMENT_FOUND', finalEventTypes: ['restart.interrupted_execution'], requiredEvents: ['execution.start_requested', 'restart.interrupted_execution'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'RESTART_CONTAINMENT_ALREADY_EXITED', finalEventTypes: ['restart.interrupted_execution'], requiredEvents: ['execution.start_requested', 'restart.interrupted_execution'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'RESTART_TERMINATION_FAILED', finalEventTypes: ['containment.termination_failed'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'containment.termination_failed'], forbiddenEvents: ['execution.completed', 'containment.terminated'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, containmentRequired: true, recoveryClass: 'TERMINAL_NO_RECOVERY', recoverable: false }),
  contract({ state: 'FAILED', reason: 'RESTART_CONTAINMENT_IDENTITY_MISMATCH', finalEventTypes: ['restart.interrupted_execution'], requiredEvents: ['execution.start_requested', 'restart.interrupted_execution'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, recoveryClass: 'POLICY_CHANGED', recoverable: false, integritySensitive: true }),
  contract({ state: 'FAILED', reason: 'TIMED_OUT', finalEventTypes: ['execution.failed'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'execution.failed'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, containmentRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'START_FAILED', finalEventTypes: ['execution.failed'], requiredEvents: ['execution.start_requested', 'execution.failed'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'EXECUTION_FAILED', finalEventTypes: ['execution.failed'], requiredEvents: ['execution.start_requested', 'execution.failed'], forbiddenEvents: ['execution.completed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'FAILED', reason: 'TERMINATION_FAILED', finalEventTypes: ['containment.termination_failed'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'containment.termination_failed'], forbiddenEvents: ['execution.completed', 'containment.terminated'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, containmentRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'CANCELLED', reason: 'RESTART_CONTAINMENT_TERMINATED', finalEventTypes: ['containment.terminated'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'containment.terminated'], forbiddenEvents: ['execution.completed', 'execution.failed', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'INVALIDATED', executionRequired: true, containmentRequired: true, recoveryClass: 'REPROPOSAL_ALLOWED', recoverable: true }),
  contract({ state: 'CANCELLED', reason: 'CANCELLED', finalEventTypes: ['containment.terminated'], finalEventReasons: ['USER_CANCELLED'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'containment.terminated'], forbiddenEvents: ['execution.completed', 'execution.failed', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, containmentRequired: true, recoveryClass: 'TERMINAL_NO_RECOVERY', recoverable: false }),
  contract({ state: 'CANCELLED', reason: 'SHUTDOWN_TERMINATED', finalEventTypes: ['containment.terminated'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'containment.terminated'], forbiddenEvents: ['execution.completed', 'execution.failed', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, containmentRequired: true, recoveryClass: 'TERMINAL_NO_RECOVERY', recoverable: false }),
  contract({ state: 'CANCELLED', reason: 'CANCELLED_BEFORE_SPAWN', finalEventTypes: ['cancellation.requested'], requiredEvents: ['cancellation.requested'], forbiddenEvents: EXECUTION_EVENTS, allowedFinalPriorStates: ['AWAITING_APPROVAL', 'APPROVED'], approvalLifecycle: 'INVALIDATED', executionForbidden: true, containmentForbidden: true, recoveryClass: 'TERMINAL_NO_RECOVERY', recoverable: false }),
  contract({ state: 'COMPLETED', reason: 'COMPLETED', finalEventTypes: ['execution.completed'], finalEventReasons: ['PROCESS_EXITED'], requiredEvents: ['execution.start_requested', 'execution.spawned', 'execution.completed'], forbiddenEvents: ['execution.failed', 'containment.terminated', 'containment.termination_failed'], allowedFinalPriorStates: ['EXECUTING'], approvalLifecycle: 'CONSUMED', executionRequired: true, containmentRequired: true, recoveryClass: 'TERMINAL_NO_RECOVERY', recoverable: false }),
]);
const CONTRACT_BY_STATE_REASON = new Map(CONTRACTS.map((entry) => [`${entry.state}:${entry.reason}`, entry]));
const RECOVERY_PRODUCTION_REASONS = Object.freeze(CONTRACTS.map((entry) => ({ state: entry.state, reason: entry.reason, terminalEvents: [...entry.finalEventTypes], recoveryClass: entry.recoveryClass, recoverable: entry.recoverable })));

export function validateRecoverySourceProvenance(input: RecoverySourceProvenanceInput): RecoverySourceProvenanceResult {
  const { run, events, workspaceIdentity, allowedRecipes, now } = input;
  const digest = recoveryEventDigest(events);
  const classification = classifyRecovery(run, run.workspaceIdentity === workspaceIdentity, allowedRecipes.includes(run.recipeId));
  const fail = (code: RecoverySourceProvenanceCode, recoveryClass = classification): RecoverySourceProvenanceResult => ({
    trusted: false,
    code,
    explanation: provenanceExplanation(code),
    recoveryClass,
    eligible: false,
    highestSeq: highestSeq(events),
    digest,
  });

  if (!validRunFields(run)) return fail('SOURCE_SCHEMA_INVALID', 'SCHEMA_INCOMPATIBLE');
  if (run.workspaceIdentity !== workspaceIdentity) return fail('SOURCE_WORKSPACE_MISMATCH', 'WORKSPACE_MISMATCH');
  if (!allowedRecipes.includes(run.recipeId)) return fail('SOURCE_RECIPE_DISABLED', 'RECIPE_DISABLED');
  if (!TERMINAL.has(run.state)) return fail('SOURCE_NOT_TERMINAL', 'NONE');
  if (run.successorRunId) return fail('SOURCE_HAS_ACTIVE_SUCCESSOR', 'TERMINAL_NO_RECOVERY');
  if (run.reconciliationOwner && (run.reconciliationLeaseUntil ?? 0) >= now) return fail('SOURCE_UNDER_RECONCILIATION', classification);
  const structural = validateEventChain(run, events);
  if (structural !== 'TRUSTED') return fail(structural, structural === 'AUDIT_SEQUENCE_MISMATCH' ? 'SCHEMA_INCOMPATIBLE' : classification);

  const contractResult = validateTerminalContract(run, events);
  if (contractResult.code !== 'TRUSTED') return fail(contractResult.code, contractResult.recoveryClass);
  if (contractResult.contract.integritySensitive) return fail('SOURCE_INTEGRITY_SENSITIVE_FAILURE', contractResult.contract.recoveryClass);
  if (!contractResult.contract.recoverable || !RECOVERABLE.has(contractResult.contract.recoveryClass)) return fail('SOURCE_INTEGRITY_FAILED', contractResult.contract.recoveryClass);

  const metadata = validateStateSpecificMetadata(run, events);
  if (metadata !== 'TRUSTED') return fail(metadata, classification);

  return {
    trusted: true,
    code: 'TRUSTED',
    explanation: recoveryExplanation(classification, run),
    recoveryClass: contractResult.contract.recoveryClass,
    eligible: true,
    highestSeq: highestSeq(events),
    digest,
  };
}

export function recoveryEventDigest(events: readonly DurableAgentRunEvent[]): string {
  const canonical = [...events]
    .sort((a, b) => a.seq - b.seq || a.eventId.localeCompare(b.eventId))
    .map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      seq: event.seq,
      type: event.type,
      priorState: event.priorState ?? null,
      nextState: event.nextState,
      reason: event.reason ?? null,
      correlationId: event.correlationId,
      source: event.source,
      schemaVersion: event.schemaVersion,
    }));
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function recoveryProductionReasonContracts(): readonly { state: DurableAgentRunState; reason: string; terminalEvents: readonly string[]; recoveryClass: AgentModeRecoveryClass; recoverable: boolean }[] {
  return RECOVERY_PRODUCTION_REASONS;
}

export function recoveryClassCanCreateFreshProposal(recoveryClass: AgentModeRecoveryClass): boolean {
  return RECOVERABLE.has(recoveryClass);
}

function validateEventChain(run: DurableAgentRun, events: readonly DurableAgentRunEvent[]): RecoverySourceProvenanceCode {
  if (events.length === 0) return 'MISSING_REQUIRED_EVENT';
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const eventIds = new Set<string>();
  let priorNext: DurableAgentRunState | undefined;
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    const expectedSeq = index + 1;
    if (event.seq !== expectedSeq) return 'EVENT_SEQUENCE_GAP';
    if (eventIds.has(event.eventId)) return 'SOURCE_INTEGRITY_FAILED';
    eventIds.add(event.eventId);
    if (event.runId !== run.runId || event.correlationId !== run.correlationId) return 'SOURCE_INTEGRITY_FAILED';
    if (event.schemaVersion !== run.schemaVersion || !EVENT_SOURCES.has(event.source)) return 'SOURCE_SCHEMA_INVALID';
    if (!PROVENANCE_EVENT_TYPES.has(event.type)) return 'SOURCE_EVENT_TYPE_UNSUPPORTED';
    if (index === 0 && event.type !== 'run.created') return 'MISSING_REQUIRED_EVENT';
    if (event.priorState !== undefined && event.priorState !== priorNext) return 'ILLEGAL_STATE_TRANSITION';
    if (index > 0 && event.priorState === undefined && event.nextState !== priorNext) return 'ILLEGAL_STATE_TRANSITION';
    priorNext = event.nextState;
  }
  if (!sorted.some((event) => event.type === 'proposal.created')) return 'MISSING_REQUIRED_EVENT';
  if (!isTerminalEvent(sorted.at(-1)!, run.state)) return 'TERMINAL_STATE_MISMATCH';
  if (run.auditSeq !== sorted.at(-1)!.seq) return 'AUDIT_SEQUENCE_MISMATCH';
  return 'TRUSTED';
}

function validateTerminalContract(run: DurableAgentRun, events: readonly DurableAgentRunEvent[]): { code: 'TRUSTED'; contract: TerminalContract } | { code: RecoverySourceProvenanceFailureCode; recoveryClass: AgentModeRecoveryClass } {
  if (!APPROVAL_LIFECYCLE.has(run.approvalLifecycle)) return { code: 'APPROVAL_LIFECYCLE_MISMATCH', recoveryClass: 'SCHEMA_INCOMPATIBLE' };
  const reason = terminalReasonFor(run);
  const contract = CONTRACT_BY_STATE_REASON.get(`${run.state}:${reason}`);
  if (!contract) {
    if (CONTRACTS.some((entry) => entry.state === run.state)) return { code: 'SOURCE_TERMINAL_REASON_INVALID', recoveryClass: classifyRecovery(run, true, true) };
    return { code: 'SOURCE_RECOVERY_CONTRACT_MISSING', recoveryClass: 'SCHEMA_INCOMPATIBLE' };
  }
  const types = new Set(events.map((event) => event.type));
  const final = [...events].sort((a, b) => a.seq - b.seq).at(-1);
  if (!final || !contract.finalEventTypes.includes(final.type) || !terminalEventReasonMatches(contract, final.reason) || final.nextState !== contract.state) return { code: 'SOURCE_TERMINAL_EVENT_INVALID', recoveryClass: contract.recoveryClass };
  if (final.priorState && !contract.allowedFinalPriorStates.includes(final.priorState)) return { code: 'SOURCE_EVENT_CHAIN_IMPOSSIBLE', recoveryClass: contract.recoveryClass };
  for (const required of contract.requiredEvents) if (!types.has(required)) return { code: 'MISSING_REQUIRED_EVENT', recoveryClass: contract.recoveryClass };
  for (const forbidden of contract.forbiddenEvents ?? []) if (types.has(forbidden)) return { code: 'SOURCE_EVENT_CHAIN_IMPOSSIBLE', recoveryClass: contract.recoveryClass };
  if (run.approvalLifecycle !== contract.approvalLifecycle) return { code: 'APPROVAL_LIFECYCLE_MISMATCH', recoveryClass: contract.recoveryClass };
  if (contract.approvalDecisionType && run.approvalDecisionType !== contract.approvalDecisionType) return { code: 'APPROVAL_LIFECYCLE_MISMATCH', recoveryClass: contract.recoveryClass };
  if (contract.executionRequired && run.executionStartedAt === undefined) return { code: 'SOURCE_METADATA_INCOMPLETE', recoveryClass: contract.recoveryClass };
  if (contract.executionForbidden && (run.executionStartedAt !== undefined || types.has('execution.start_requested'))) return { code: 'SOURCE_EVENT_CHAIN_IMPOSSIBLE', recoveryClass: contract.recoveryClass };
  if (contract.containmentRequired && (!run.containmentUnit || !run.containmentBinding || !types.has('execution.spawned'))) return { code: 'SOURCE_METADATA_INCOMPLETE', recoveryClass: contract.recoveryClass };
  if (contract.containmentForbidden && (run.containmentUnit || run.containmentBinding || types.has('execution.spawned'))) return { code: 'SOURCE_EVENT_CHAIN_IMPOSSIBLE', recoveryClass: contract.recoveryClass };
  return { code: 'TRUSTED', contract };
}

function validateStateSpecificMetadata(run: DurableAgentRun, events: readonly DurableAgentRunEvent[]): RecoverySourceProvenanceCode {
  if (!hasText(run.proposalHash) || !hasText(run.proposalFingerprint) || !hasText(run.snapshotId) || !hasText(run.snapshotManifestDigest) || !hasText(run.executableDigest)) return 'SOURCE_METADATA_INCOMPLETE';
  if (run.proposalAt === undefined || run.terminalAt === undefined || run.terminalAt < run.requestedAt) return 'SOURCE_METADATA_INCOMPLETE';
  if (!validJsonArray(run.expectedEffectsJson)) return 'SOURCE_METADATA_INCOMPLETE';
  if (run.previewJson !== undefined && !validJsonObject(run.previewJson)) return 'SOURCE_METADATA_INCOMPLETE';
  if (!events.some((event) => event.type === 'run.created') || !events.some((event) => event.type === 'proposal.created')) return 'MISSING_REQUIRED_EVENT';
  if ((run.state === 'FAILED' || run.state === 'CANCELLED') && !run.executionStartedAt && events.some((event) => event.type === 'execution.spawned')) return 'SOURCE_METADATA_INCOMPLETE';
  return 'TRUSTED';
}

function isTerminalEvent(event: DurableAgentRunEvent, state: DurableAgentRunState): boolean {
  return event.nextState === state && TERMINAL.has(event.nextState);
}

function validRunFields(run: DurableAgentRun): boolean {
  return run.schemaVersion === 1
    && Number.isInteger(run.version) && run.version > 0
    && Number.isInteger(run.auditSeq) && run.auditSeq > 0
    && hasText(run.runId)
    && hasText(run.correlationId)
    && hasText(run.workspaceIdentity)
    && hasText(run.recipePolicyVersion)
    && RECIPES.has(run.recipeId);
}

function classifyRecovery(run: DurableAgentRun, workspaceMatches: boolean, recipeAvailable: boolean): AgentModeRecoveryClass {
  if (!workspaceMatches) return 'WORKSPACE_MISMATCH';
  if (!recipeAvailable) return 'RECIPE_DISABLED';
  if (run.successorRunId) return 'TERMINAL_NO_RECOVERY';
  if (!TERMINAL.has(run.state)) return 'NONE';
  if (run.failureCode === 'RESTART_CONTAINMENT_IDENTITY_MISMATCH') return 'POLICY_CHANGED';
  if (run.failureCode === 'RESTART_AUTHORIZATION_LOST' || run.approvalLifecycle === 'LOST_ON_RESTART') return 'REPROPOSAL_REQUIRED';
  if (run.failureCode === 'RESTART_BEFORE_EXECUTION') return 'REPROPOSAL_REQUIRED';
  if (run.failureCode === 'INTERRUPTED_BY_RESTART' || run.failureCode === 'RESTART_NO_CONTAINMENT_FOUND' || run.failureCode === 'RESTART_CONTAINMENT_ALREADY_EXITED') return 'REPROPOSAL_ALLOWED';
  if (run.failureCode === 'RESTART_CONTAINMENT_TERMINATED') return 'REPROPOSAL_ALLOWED';
  if (run.state === 'REJECTED' || run.state === 'EXPIRED' || run.state === 'STALE') return run.recoveryClass === 'SNAPSHOT_CHANGED' ? 'SNAPSHOT_CHANGED' : 'REPROPOSAL_ALLOWED';
  if (run.state === 'FAILED' && run.failureCode && !run.failureCode.includes('POLICY') && !run.failureCode.includes('IDENTITY')) return 'REPROPOSAL_ALLOWED';
  return 'TERMINAL_NO_RECOVERY';
}

function provenanceExplanation(code: RecoverySourceProvenanceCode): string {
  switch (code) {
    case 'SOURCE_WORKSPACE_MISMATCH': return 'This run belongs to a different workspace.';
    case 'SOURCE_RECIPE_DISABLED': return 'This action is no longer allowed by the current policy.';
    case 'SOURCE_HAS_ACTIVE_SUCCESSOR': return 'This run already has an active recovery successor.';
    case 'SOURCE_UNDER_RECONCILIATION': return 'The source run is currently under restart reconciliation.';
    case 'SOURCE_NOT_TERMINAL': return 'Wait for the active run to reach a terminal state.';
    case 'SOURCE_TERMINAL_REASON_INVALID': return 'This run’s terminal reason is not supported for safe recovery.';
    case 'SOURCE_TERMINAL_EVENT_INVALID': return 'This run’s terminal event does not match its terminal reason, so MigraPilot cannot safely create a recovery proposal.';
    case 'SOURCE_EVENT_TYPE_UNSUPPORTED': return 'This run contains an unsupported durable event type, so MigraPilot cannot safely create a recovery proposal.';
    case 'SOURCE_EVENT_CHAIN_IMPOSSIBLE': return 'This run’s durable event order is not a production-emittable recovery history.';
    case 'SOURCE_RECOVERY_CONTRACT_MISSING': return 'This run has no explicit safe recovery contract.';
    case 'SOURCE_INTEGRITY_SENSITIVE_FAILURE': return 'This run ended with an integrity-sensitive failure and requires investigation before recovery.';
    case 'MISSING_REQUIRED_EVENT': return 'This run’s durable history is incomplete, so MigraPilot cannot safely create a recovery proposal.';
    case 'EVENT_SEQUENCE_GAP': return 'This run’s durable history is incomplete, so MigraPilot cannot safely create a recovery proposal.';
    case 'ILLEGAL_STATE_TRANSITION': return 'This run’s durable history is inconsistent and requires investigation before recovery.';
    case 'TERMINAL_STATE_MISMATCH': return 'This run’s durable history is inconsistent and requires investigation before recovery.';
    case 'AUDIT_SEQUENCE_MISMATCH': return 'This run’s audit sequence is inconsistent and requires investigation before recovery.';
    case 'APPROVAL_LIFECYCLE_MISMATCH': return 'This run’s approval lifecycle is inconsistent and requires investigation before recovery.';
    case 'SOURCE_METADATA_INCOMPLETE': return 'This run’s durable metadata is incomplete, so MigraPilot cannot safely create a recovery proposal.';
    case 'SOURCE_SCHEMA_INVALID': return 'This run’s durable schema is incompatible with safe recovery.';
    case 'SOURCE_INTEGRITY_FAILED': return 'This run’s durable history failed integrity validation and requires investigation before recovery.';
    case 'TRUSTED': return 'Create a fresh proposal if you still want to run this read-only recipe.';
  }
}

function terminalReasonFor(run: DurableAgentRun): string {
  if (run.state === 'COMPLETED') return 'COMPLETED';
  return run.failureCode ?? run.interruptionClassification ?? run.recoveryReason ?? '';
}

function contract(input: TerminalContract): TerminalContract {
  return Object.freeze(input);
}

function terminalEventReasonMatches(contract: TerminalContract, eventReason: string | undefined): boolean {
  return (contract.finalEventReasons ?? [contract.reason]).includes(eventReason ?? '');
}

function recoveryExplanation(classification: AgentModeRecoveryClass, run: DurableAgentRun): string {
  const reason = run.failureCode ?? run.interruptionClassification ?? run.recoveryReason;
  if (reason === 'RESTART_AUTHORIZATION_LOST') return 'Approval could not survive the service restart. Create a fresh proposal to review the command again.';
  if (reason === 'RESTART_BEFORE_EXECUTION') return 'The previous approval was invalidated before execution began. Nothing was executed.';
  if (reason === 'INTERRUPTED_BY_RESTART') return 'The command was interrupted during service restart and was not resumed.';
  if (reason === 'RESTART_CONTAINMENT_TERMINATED') return 'The isolated command was stopped during restart reconciliation.';
  if (classification === 'SNAPSHOT_CHANGED') return 'The prior proposal is stale. Create a fresh proposal with the current workspace snapshot.';
  if (run.state === 'REJECTED') return 'The rejection remains final for that proposal. You may create a separate fresh proposal.';
  if (run.state === 'EXPIRED') return 'Approval expired. Create a fresh proposal to review the command again.';
  return 'Create a fresh proposal if you still want to run this read-only recipe.';
}

function highestSeq(events: readonly DurableAgentRunEvent[]): number {
  return events.reduce((max, event) => Math.max(max, event.seq), 0);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function validJsonArray(value: string): boolean {
  try { return Array.isArray(JSON.parse(value)); } catch { return false; }
}

function validJsonObject(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}
