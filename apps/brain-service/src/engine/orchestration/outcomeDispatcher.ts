/*
 * RUNS AN OUTCOME, NOT A MODEL.
 *
 * The dispatcher knows nothing about mockups, pages or any particular request.
 * It takes a typed plan, resolves what each step needs, dispatches the qualified
 * specialist for it, and carries the user's ORIGINAL objective into every child.
 * Adding an outcome is a change to the plan, never to this file.
 *
 * THE PARENT OBJECTIVE OUTLIVES EVERY CHILD. This is the defect that made a
 * build request come back as a description of a screenshot: the vision child
 * produced good text, and good text was mistaken for the answer. Here a child
 * result is intermediate CONTEXT unless its step is marked terminal in the plan,
 * so a successful child cannot quietly end the turn.
 *
 * FAILURE HAPPENS AT ITS OWN BOUNDARY. When a step cannot run — no authority, no
 * qualified specialist, a tool that refused — the run stops AT THAT STEP and
 * says which one and why. It does not fall through to a weaker workflow, and it
 * does not answer with generic advice, because an answer that looks helpful
 * while delivering nothing asked for is worse than a refusal.
 */

import { STEP_LABEL } from '@migrapilot/shared-types/outcome-plan';
import {
  authoritySatisfies,
  authorityShortfall,
  type ProjectAuthority,
} from '@migrapilot/shared-types/project-authority';
import type { CapabilityStep, OutcomePlan, OutcomeStep } from '@migrapilot/shared-types/outcome-plan';

/** One child dispatch, recorded whether it succeeded or not. */
export interface ChildDispatchRecord {
  parentTurnId: string;
  step: CapabilityStep;
  /** The capability asked for, e.g. `vision.general` or a task class. */
  capabilityRequested?: string;
  /** The Migra family selected to serve it. */
  selectedFamily?: string;
  /** What actually ran. Kept apart from the selection, always. */
  executedBackend?: string;
  /** Which project authority the step executed under. */
  toolAuthority: string;
  outcome: 'ok' | 'failed' | 'skipped';
  /** Present when the step failed — the actionable reason. */
  failure?: string;
  startedAt: string;
  finishedAt: string;
}

export interface StepContext {
  /** The user's original words. Never replaced by a child result. */
  objective: string;
  /** Everything earlier steps produced, in order. Intermediate context. */
  priorResults: Array<{ step: CapabilityStep; result: unknown }>;
  authority: ProjectAuthority;
  parentTurnId: string;
}

export interface StepOutcome {
  result: unknown;
  capabilityRequested?: string;
  selectedFamily?: string;
  executedBackend?: string;
}

/** Executes one capability. Absent from the map means "not available here". */
export type StepExecutor = (ctx: StepContext) => Promise<StepOutcome>;

export interface DispatchDeps {
  parentTurnId: string;
  authority: ProjectAuthority;
  executors: Partial<Record<CapabilityStep, StepExecutor>>;
  /** Called as each child settles, so provenance is durable even on a crash. */
  onRecord?: (record: ChildDispatchRecord) => void;
}

export interface DispatchResult {
  completed: boolean;
  /** The result of the TERMINAL step, when the plan ran to completion. */
  answer?: unknown;
  /** Where it stopped, when it did not complete. */
  stoppedAt?: CapabilityStep;
  failure?: string;
  records: ChildDispatchRecord[];
}

function record(
  base: Pick<ChildDispatchRecord, 'parentTurnId' | 'step' | 'toolAuthority'>,
  startedAt: string,
  rest: Partial<ChildDispatchRecord>,
): ChildDispatchRecord {
  return { ...base, startedAt, finishedAt: new Date().toISOString(), outcome: 'ok', ...rest };
}

export async function dispatchOutcome(plan: OutcomePlan, deps: DispatchDeps): Promise<DispatchResult> {
  const records: ChildDispatchRecord[] = [];
  const priorResults: Array<{ step: CapabilityStep; result: unknown }> = [];
  const authorityLabel = `${deps.authority.kind}:${deps.authority.label}`;

  const emit = (r: ChildDispatchRecord): void => {
    records.push(r);
    deps.onRecord?.(r);
  };

  for (const step of plan.steps) {
    const startedAt = new Date().toISOString();
    const base = { parentTurnId: deps.parentTurnId, step: step.step, toolAuthority: authorityLabel };

    /*
     * AUTHORITY IS CHECKED BEFORE THE SPECIALIST IS ASKED.
     *
     * Dispatching first and discovering afterwards that nothing may be written
     * wastes real work and, worse, produces a plausible result the user cannot
     * act on. The boundary is the honest place to stop.
     */
    if (step.needs && !authoritySatisfies(deps.authority, step.needs)) {
      // The label, never the id — see decide.ts. Same leak, same fix.
      const failure = `${STEP_LABEL[step.step]} needs a project, and ${authorityShortfall(deps.authority)}`;
      emit(record(base, startedAt, { outcome: 'failed', failure }));
      return { completed: false, stoppedAt: step.step, failure, records };
    }

    const executor = deps.executors[step.step];
    if (!executor) {
      // A missing executor is a CAPABILITY gap, named as one rather than skipped.
      const failure = `${STEP_LABEL[step.step]} is not available here yet`;
      emit(record(base, startedAt, { outcome: 'failed', failure }));
      return { completed: false, stoppedAt: step.step, failure, records };
    }

    let outcome: StepOutcome;
    try {
      outcome = await executor({
        // The objective travels unchanged. A child never rewrites it.
        objective: plan.objective,
        priorResults: [...priorResults],
        authority: deps.authority,
        parentTurnId: deps.parentTurnId,
      });
    } catch (err) {
      const failure = `${step.step} failed: ${err instanceof Error ? err.message : String(err)}`;
      emit(record(base, startedAt, { outcome: 'failed', failure }));
      return { completed: false, stoppedAt: step.step, failure, records };
    }

    emit(
      record(base, startedAt, {
        capabilityRequested: outcome.capabilityRequested,
        selectedFamily: outcome.selectedFamily,
        executedBackend: outcome.executedBackend,
      }),
    );
    priorResults.push({ step: step.step, result: outcome.result });

    /*
     * Only a step the PLAN marked terminal may end the turn. A vision read that
     * produced excellent text still returns to the loop when the objective was
     * to build something.
     */
    if (step.terminal) {
      return { completed: true, answer: outcome.result, records };
    }
  }

  // Ran every step and none was terminal: the plan is malformed, and saying so
  // is better than returning the last intermediate result as though it were an
  // answer — which is precisely the original defect.
  return {
    completed: false,
    failure: 'the plan completed without a terminal step, so there is no answer to return',
    records,
  };
}
