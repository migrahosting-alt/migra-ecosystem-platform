/*
 * THE STEPS AN OUTCOME REQUIRES.
 *
 * A user asks for a result, not for a model. "Build this from a mockup" is not
 * one capability, it is a sequence — read the design, turn it into a spec, plan
 * the change, look at the project, propose files, check the result — and the
 * user should never have to drive that by switching models between steps.
 *
 * The plan is data, so the dispatcher that runs it contains no knowledge of any
 * particular outcome, and adding an outcome does not mean editing a router.
 */

import type { TurnIntent } from './turnIntent.js';

export type CapabilityStep =
  | 'vision.read'
  | 'design.spec'
  | 'engineer.plan'
  | 'workspace.inspect'
  | 'changeset.propose'
  | 'verification'
  /** Answer the user directly. Terminal by construction. */
  | 'answer';

export interface OutcomeStep {
  step: CapabilityStep;
  /** What this step needs from the project authority, if anything. */
  needs?: { read?: boolean; propose?: boolean; apply?: boolean };
  /**
   * May this step's output be the user's answer?
   *
   * False for every intermediate step. A vision read producing good text is
   * exactly how a build request came to be answered with a description of a
   * screenshot — the step succeeded and the OBJECTIVE was abandoned.
   */
  terminal: boolean;
}

export interface OutcomePlan {
  /** The user's original words. Carried through every child dispatch, unchanged. */
  objective: string;
  intent: TurnIntent;
  steps: OutcomeStep[];
}

const ANSWER: OutcomeStep = { step: 'answer', terminal: true };

/** Build the step sequence an intent requires. Data, not control flow. */
export function planOutcome(input: {
  objective: string;
  intent: TurnIntent;
  hasImage: boolean;
  /**
   * Does the caller hold a project it can read?
   *
   * This changes the shape of an ORDINARY turn, and deliberately so. Where a
   * workspace exists, every ordinary turn runs the tool-capable agent: a keyword
   * classifier deciding which phrasings are "allowed" to touch the workspace is
   * what once stranded real build orders in a tool-less path, where the model —
   * asked for a completion report it could not produce — invented one. Where
   * there is no project, the same turn is simply a conversation.
   */
  workspaceAvailable?: boolean;
}): OutcomePlan {
  const { objective, intent, hasImage } = input;
  const visionFirst: OutcomeStep[] = hasImage
    ? [
        { step: 'vision.read', terminal: false },
        { step: 'design.spec', terminal: false },
      ]
    : [];

  switch (intent) {
    case 'implement':
      return {
        objective,
        intent,
        steps: [
          ...visionFirst,
          { step: 'engineer.plan', terminal: false },
          { step: 'workspace.inspect', needs: { read: true }, terminal: false },
          { step: 'changeset.propose', needs: { read: true, propose: true }, terminal: false },
          { step: 'verification', needs: { read: true }, terminal: true },
        ],
      };
    case 'modify_existing':
      return {
        objective,
        intent,
        steps: [
          ...visionFirst,
          // Reading what EXISTS comes before planning: a change to code nobody
          // has looked at is a rewrite wearing the word "modify".
          { step: 'workspace.inspect', needs: { read: true }, terminal: false },
          { step: 'engineer.plan', terminal: false },
          { step: 'changeset.propose', needs: { read: true, propose: true }, terminal: false },
          { step: 'verification', needs: { read: true }, terminal: true },
        ],
      };
    case 'describe':
    case 'analyze':
    case 'critique':
      // Here the vision read IS the outcome, so it terminates legitimately.
      return {
        objective,
        intent,
        steps: hasImage ? [{ step: 'vision.read', terminal: true }] : [ANSWER],
      };
    default:
      // An ordinary turn WITH a project is agent-eligible; without one it is a
      // conversation. Authority decides, not phrasing.
      return input.workspaceAvailable
        ? {
            objective,
            intent,
            steps: [
              { step: 'engineer.plan', terminal: false },
              { step: 'workspace.inspect', needs: { read: true }, terminal: true },
            ],
          }
        : { objective, intent, steps: [ANSWER] };
  }
}

/** Steps that cannot run under this authority, in plan order. */
export function unsupportedSteps(
  plan: OutcomePlan,
  can: (needs: NonNullable<OutcomeStep['needs']>) => boolean,
): CapabilityStep[] {
  return plan.steps.filter((s) => s.needs && !can(s.needs)).map((s) => s.step);
}
