/*
 * THE ONE PLACE ROUTING IS DECIDED.
 *
 * A client submits facts — the objective, what is attached, the authority it
 * holds — and gets back what to do. It does not compute intent, does not decide
 * whether a design read may answer the user, and does not choose what follows
 * what. Everything that used to live in two clients lives here once.
 *
 * Authority is evaluated SEPARATELY from capability. "This turn needs the
 * engineer" and "this caller may write to a project" are different questions
 * with different answers, and collapsing them is how a surface became a
 * capability: the consumer could not build, so it was treated as a planner
 * forever instead of as a caller that had presented no project.
 */

import {
  planOutcome,
  STEP_LABEL,
  type CapabilityStep,
  type OutcomeStep,
} from '@migrapilot/shared-types/outcome-plan';
import {
  authoritySatisfies,
  authorityShortfall,
  NO_AUTHORITY,
  type ProjectAuthority,
} from '@migrapilot/shared-types/project-authority';
import { planTurn } from '@migrapilot/shared-types/turn-intent';
import {
  ORCHESTRATION_PLAN_REVISION,
  type DecidedStep,
  type OrchestrationDecision,
  type OrchestrationRequest,
} from '@migrapilot/shared-types/orchestration-decision';

const IMAGE_MIME = /^image\//i;

/** Normalise a client's declared authority. Absent fields are NOT assumed true. */
export function authorityFrom(declared: OrchestrationRequest['authority']): ProjectAuthority {
  if (!declared || declared.kind === 'none') return NO_AUTHORITY;
  return {
    kind: declared.kind,
    ...(declared.id ? { id: declared.id } : {}),
    label: declared.label ?? declared.kind,
    // Fail closed: an authority that does not claim a permission does not have it.
    canRead: declared.canRead === true,
    canPropose: declared.canPropose === true,
    canApply: declared.canApply === true,
  };
}

export function decideOrchestration(request: OrchestrationRequest): OrchestrationDecision {
  const objective = (request.objective ?? '').trim();
  const hasImage = (request.attachmentMimeTypes ?? []).some((m) => IMAGE_MIME.test(m ?? ''));
  const authority = authorityFrom(request.authority);

  const turn = planTurn({ text: objective, hasImageAttachment: hasImage });
  // Authority shapes an ordinary turn: with a readable project it runs the
  // tool-capable agent, without one it is a conversation.
  const plan = planOutcome({ objective, intent: turn.intent, hasImage, workspaceAvailable: authority.canRead });

  const permits = (needs: OutcomeStep['needs']): boolean =>
    !needs || authoritySatisfies(authority, needs);

  const steps: DecidedStep[] = plan.steps.map((s) => {
    const permitted = permits(s.needs);
    return {
      step: s.step,
      terminal: s.terminal,
      permitted,
      ...(permitted ? {} : { blockedBecause: authorityShortfall(authority) }),
    };
  });

  const firstBlocked = steps.find((s) => !s.permitted);
  const terminal = steps.find((s) => s.terminal)?.step;

  /*
   * The convenience flags are DERIVED from the step list, never computed
   * alongside it. Two sources for one answer is how a client ends up acting on
   * the version that happens to be wrong.
   */
  const requiresVision = steps.some((s) => s.step === 'vision.read');
  const requiresEngineer = steps.some((s) => s.step === 'engineer.plan');
  const visionIsTerminal = steps.some((s) => s.step === 'vision.read' && s.terminal);

  return {
    planRevision: ORCHESTRATION_PLAN_REVISION,
    objective,
    intent: turn.intent,
    steps,
    ...(terminal ? { terminalStep: terminal } : {}),
    executable: !firstBlocked,
    ...(firstBlocked ? { failureBoundary: firstBlocked.step as CapabilityStep } : {}),
    reason: firstBlocked
      /*
       * 🚨 THE LABEL, NEVER THE STEP ID. This line put `workspace.inspect` on a
       * user's screen in the real product. The refusal was correct; the
       * identifier was internal vocabulary that tells a person nothing they can
       * act on.
       */
      ? `${STEP_LABEL[firstBlocked.step]} needs a project, and ${authorityShortfall(authority)}`
      : turn.reason,
    requiresVision,
    requiresEngineer,
    visionIsTerminal,
  };
}
