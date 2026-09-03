/*
 * WHAT THE BRAIN DECIDED — the only routing answer a client may act on.
 *
 * CLIENTS EXPRESS CONTEXT AND AUTHORITY; THE BRAIN OWNS ORCHESTRATION.
 *
 * Both surfaces used to decide locally and drifted into opposite bugs from one
 * cause: the consumer answered a build request with a description of the
 * screenshot, while the extension entered the build agent whenever an image had
 * produced a design spec. Sharing an intent contract stopped them disagreeing;
 * it did not stop them DECIDING. Two copies of a correct decision still drift.
 *
 * So a client now submits what it has — the objective, what is attached, and the
 * project authority it holds — and receives this. It renders progress, executes
 * delegated tools, and does not choose whether vision is terminal, whether the
 * engineer runs, or what follows what.
 */

import type { CapabilityStep } from './outcomePlan.js';
import type { ProjectAuthorityKind } from './projectAuthority.js';
import type { TurnIntent } from './turnIntent.js';

/** What a client tells the Brain. Facts it holds — never a routing opinion. */
export interface OrchestrationRequest {
  objective: string;
  /** MIME types of what is attached, so the Brain decides if vision is needed. */
  attachmentMimeTypes?: string[];
  /** The authority this caller actually holds. Declared, never inferred. */
  authority: {
    kind: ProjectAuthorityKind;
    id?: string;
    label?: string;
    canRead?: boolean;
    canPropose?: boolean;
    canApply?: boolean;
  };
  /** Which surface is asking. For provenance ONLY — never for routing. */
  surface: 'migrapilot-consumer' | 'vscode-extension';
}

export interface DecidedStep {
  step: CapabilityStep;
  /** May this step's output be shown to the user as the answer? */
  terminal: boolean;
  /** Whether the caller's authority can carry it. */
  permitted: boolean;
  /** Present when `permitted` is false — the actionable reason. */
  blockedBecause?: string;
}

export interface OrchestrationDecision {
  /** Bumped when planning behaviour changes, so evidence names what decided. */
  planRevision: string;
  objective: string;
  intent: TurnIntent;
  steps: DecidedStep[];
  /** The step whose output may complete the turn, when the plan can run at all. */
  terminalStep?: CapabilityStep;
  /** True when every step the plan needs is permitted by the caller's authority. */
  executable: boolean;
  /** The first step the authority cannot carry. The honest place to stop. */
  failureBoundary?: CapabilityStep;
  /** Why, in words a user can act on. */
  reason: string;
  /*
   * Convenience booleans, DERIVED from the steps above rather than decided
   * separately — a client that reads these gets exactly what the step list says,
   * and cannot end up acting on a second, subtly different answer.
   */
  requiresVision: boolean;
  requiresEngineer: boolean;
  visionIsTerminal: boolean;
}

export const ORCHESTRATION_PLAN_REVISION = 'orchestration/1.0.0';

/** Provenance for one parent turn, assembled as its children settle. */
export interface TurnProvenance {
  parentTurnId: string;
  requestedOutcome: string;
  planRevision: string;
  intent: TurnIntent;
  surface: string;
  executionAuthority: string;
  children: Array<{
    step: CapabilityStep;
    selectedFamily?: string;
    executedBackend?: string;
    outcome: 'ok' | 'failed' | 'skipped';
    failure?: string;
  }>;
  /** Typed intermediate artifacts, kept apart from the user-facing answer. */
  artifacts: Array<{ step: CapabilityStep; kind: string }>;
  failureBoundary?: CapabilityStep;
  completion: 'completed' | 'blocked' | 'failed';
}
