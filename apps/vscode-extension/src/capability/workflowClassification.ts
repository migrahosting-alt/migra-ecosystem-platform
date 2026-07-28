/**
 * MigraPilot — host-owned task classification.
 *
 * A turn's capability class comes from the WORKFLOW the host invoked, never from what the
 * user typed. That distinction is the whole point:
 *
 *   user asks "review this security patch" + host runs the Security Review workflow
 *     → security-review, with the authority (and the refusal) that class carries
 *
 *   user types "review this security patch" in ordinary chat
 *     → ungoverned; it can discuss the topic and cannot receive review authority
 *
 * This file therefore takes a `GovernedWorkflow` — a closed set of host actions — and never
 * a string from a message. `classifyIntent()` in `intentRouter.ts` reads prompt text to pick
 * a chat ROUTE, and must never reach this module: a model able to promote its own turn by
 * phrasing would make the capability boundary decorative, exactly as it would for grounding
 * and live knowledge.
 *
 * Classification is also NOT sticky. The evidence and live-knowledge selectors are sticky
 * host state on purpose — an operator sets them and they persist. A task class belongs to
 * one invocation: carrying it forward would let a Security Review workflow leave its class
 * behind for the next ordinary question.
 */

import type { GovernedWorkflowId, TaskClass } from '@migrapilot/protocol';

/**
 * Host workflows that carry a capability class.
 *
 * Anything not listed here is ordinary assistance and is deliberately absent rather than
 * mapped to a permissive default — an unlisted workflow gets no class, which resolves to
 * `ungoverned` and read-only authority at the Brain.
 */
export const GOVERNED_WORKFLOWS = {
  /** Build or apply a typed code change. Mutation still needs the existing approval gate. */
  'build.apply': 'typed-implementation',
  /** Diagnose a failing test or a runtime failure. */
  'diagnose.failure': 'repository-diagnosis',
  /** Prepare a bounded changeset for review WITHOUT applying it. */
  'changeset.propose': 'patch-planning',
  /** Review a diff or a pull request. */
  'review.diff': 'code-review',
  /** Security-sensitive review. */
  'review.security': 'security-review',
  /** Dependency compatibility or upgrade impact. */
  'dependency.analyze': 'dependency-analysis',
  /** A change spanning several coordinated files. */
  'change.multifile': 'multi-file-change',
  /** Governance, approval, policy, audit or authorization work. */
  'governance.approve': 'governance-compliance',
  /** Generate tests for existing code. */
  'tests.generate': 'test-generation',
} as const satisfies Record<GovernedWorkflowId, TaskClass>;

export type GovernedWorkflow = keyof typeof GOVERNED_WORKFLOWS;

export function isGovernedWorkflow(value: unknown): value is GovernedWorkflow {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(GOVERNED_WORKFLOWS, value);
}

/**
 * The task class for a host workflow, or `undefined` for ordinary assistance.
 *
 * `undefined` is the honest answer for an unrecognised workflow — the Brain resolves an
 * absent class to `ungoverned`, which permits conversation and inspection and withholds
 * everything consequential. Mapping an unknown workflow to a plausible-looking class would
 * invent authority nobody granted.
 */
export function taskClassForWorkflow(workflow: unknown): TaskClass | undefined {
  return isGovernedWorkflow(workflow) ? GOVERNED_WORKFLOWS[workflow] : undefined;
}

/**
 * The wire fragment for a turn.
 *
 * Omitted entirely for ordinary chat, so the payload for every existing caller stays
 * byte-identical and absence keeps meaning `ungoverned` rather than becoming a new default.
 */
export function taskClassPayload(
  workflow: unknown,
): { taskClass: TaskClass; workflow: GovernedWorkflowId } | Record<string, never> {
  const taskClass = taskClassForWorkflow(workflow);
  // The workflow travels WITH the class so the audit can show which host action claimed it.
  // Sent together or not at all: a class without its provenance is the weaker record, and a
  // workflow without a class would imply authority nothing granted.
  return taskClass && isGovernedWorkflow(workflow) ? { taskClass, workflow } : {};
}

/**
 * Workflows whose class the Brain currently refuses on local models.
 *
 * Advisory only — the Brain is the enforcement point and this list is a UI courtesy, so it
 * can tell an operator what will happen before the request is sent. It is deliberately NOT
 * consulted to decide whether to send: predicting a refusal locally and skipping the call
 * would put a second, drifting copy of the policy in the extension.
 */
export const LIKELY_DENIED_LOCALLY: readonly GovernedWorkflow[] = [
  'review.security',
  'review.diff',
  'changeset.propose',
  'governance.approve',
];
