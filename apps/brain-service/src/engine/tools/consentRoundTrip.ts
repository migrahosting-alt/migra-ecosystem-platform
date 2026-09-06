/**
 * THE APPROVAL ROUND-TRIP — propose, approve or decline, then dispatch once.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ADDS THAT THE RESOLVER CONTRACT DID NOT
 *
 * The router could already ASK whether consent existed. Nothing minted one. The
 * consent lifecycle was proven at the decision boundary and had no caller — a
 * contract waiting for a product. This is the product side:
 *
 *   propose  route → if consent is required and absent, MINT one and return the
 *            exact normalized mutation for the user to read
 *   decline  reject the token; nothing is dispatched, ever
 *   execute  re-route with the minted approval, re-verify the input has not
 *            moved, CONSUME the single-use token, then dispatch
 *
 * ---------------------------------------------------------------------------
 * WHY THE TOKEN IS SPENT BEFORE THE SIDE EFFECT, NOT AFTER
 *
 * Consuming after a successful dispatch would leave a live approval during the
 * exact window where a retry is most likely — a refresh, a double click, a
 * reconnect — and that window is precisely when a duplicate send or charge
 * happens. So the token is spent first. The cost is that a genuine failure needs
 * a fresh approval; the alternative cost is a second irreversible action, and
 * those are not comparable.
 *
 * It also means `approval_consumed` and `dispatch_started` are different facts
 * and are recorded as such. "We spent your approval and never tried" is a state
 * a user may need explained, and it cannot be explained by a system that
 * conflated the two.
 * ---------------------------------------------------------------------------
 */

import type { ToolApprovalStore } from './toolApprovalStore.js';
import type { DispatchStage, MutationOutcome } from './mutationOutcome.js';
import {
  hashInput,
  routeToolInvocation,
  type RouterResolvers,
  type RoutedDecision,
} from './toolRouter.js';

/** One line in the provenance trail. Order is the order things happened. */
export interface ApprovalEvent {
  stage: DispatchStage;
  at: string;
  /** Present when the stage concerns a specific approval. */
  approvalId?: string;
  detail?: string;
}

export interface ProposalResult<TInput> {
  kind: 'needs_approval' | 'executable_without_approval' | 'blocked';
  routed: RoutedDecision<TInput>;
  /** The exact normalized mutation, in the user's words. Shown before approving. */
  preview?: string;
  approvalId?: string;
  /** Set when `kind` is `blocked`. */
  message?: string;
  events: ApprovalEvent[];
}

export interface RoundTripDeps<TInput> {
  approvals: ToolApprovalStore;
  resolvers: Omit<RouterResolvers<TInput>, 'consent'>;
  /** Builds the sentence the user reads. Must describe the NORMALIZED input. */
  previewOf(normalized: TInput): string;
  now?: () => number;
  mkRequestId?: () => string;
}

const stamp = (now: () => number) => new Date(now()).toISOString();

/**
 * Step 1 — propose.
 *
 * Routes with a consent resolver that reports what the store actually holds. If
 * the tool mutates and no approval exists yet, one is minted bound to
 * (toolId, normalizedInputHash) and the caller receives the preview to show.
 *
 * Nothing is dispatched here, and nothing can be: this function has no access to
 * the tool's execute path at all.
 */
export async function propose<TInput>(
  request: { toolId: string; input: TInput },
  deps: RoundTripDeps<TInput>,
): Promise<ProposalResult<TInput>> {
  const now = deps.now ?? (() => Date.now());
  const events: ApprovalEvent[] = [];

  /*
   * First pass reports consent as ABSENT deliberately. We are asking "would this
   * be allowed to run, if approved?" — every gate before consent must pass
   * before a user is shown an approval prompt at all.
   */
  const firstPass = await routeToolInvocation<TInput>(request, {
    ...deps.resolvers,
    consent: () => ({ state: 'absent' }),
  });

  if (!firstPass.decision.requiresConsent) {
    return {
      kind: firstPass.decision.executable ? 'executable_without_approval' : 'blocked',
      routed: firstPass,
      ...(firstPass.decision.executable ? {} : { message: firstPass.decision.reason }),
      events,
    };
  }

  // Blocked for a reason OTHER than the missing consent — never prompt for it.
  if (!firstPass.decision.executable && firstPass.decision.blockedAt !== 'consent:required') {
    return { kind: 'blocked', routed: firstPass, message: firstPass.decision.reason, events };
  }

  const inputHash = firstPass.inputHash!;
  const approval = deps.approvals.mint({
    tool: request.toolId,
    inputHash,
    requestId: (deps.mkRequestId ?? (() => `req_${Math.random().toString(36).slice(2, 12)}`))(),
  });
  events.push({ stage: 'approval_minted', at: stamp(now), approvalId: approval.id });

  return {
    kind: 'needs_approval',
    routed: firstPass,
    preview: deps.previewOf(firstPass.normalizedInput!),
    approvalId: approval.id,
    events,
  };
}

/** Step 2a — the user says no. The token is rejected and nothing is attempted. */
export function decline<TInput>(
  approvalId: string,
  request: { toolId: string; input: TInput },
  normalized: TInput,
  deps: Pick<RoundTripDeps<TInput>, 'approvals' | 'now'>,
): ApprovalEvent[] {
  const now = deps.now ?? (() => Date.now());
  deps.approvals.reject(approvalId, { tool: request.toolId, inputHash: hashInput(normalized) });
  return [{ stage: 'declined', at: stamp(now), approvalId }];
}

export interface ExecutionAttempt<TInput> {
  /** Null when the approval could not be spent; then `events` says why. */
  routed: RoutedDecision<TInput> | null;
  events: ApprovalEvent[];
  refusal?: { outcome: MutationOutcome; message: string };
}

/**
 * Step 2b — the user approved. Spend the token, then hand back a routed decision
 * the caller may dispatch EXACTLY ONCE.
 *
 * The input is re-normalized and re-hashed here, from the request as it stands
 * now. If anything moved since the approval was minted, the binding no longer
 * matches and the store refuses the consume — so drift is caught by the store's
 * own check, not only by ours.
 */
export async function approveAndPrepare<TInput>(
  approvalId: string,
  request: { toolId: string; input: TInput },
  deps: RoundTripDeps<TInput>,
): Promise<ExecutionAttempt<TInput>> {
  const now = deps.now ?? (() => Date.now());
  const events: ApprovalEvent[] = [];

  const normalized = await deps.resolvers.normalize(request.input);
  const inputHash = hashInput(normalized);

  /*
   * SPENT BEFORE DISPATCH. A live approval during the retry window is how a
   * refresh becomes a second send.
   */
  const consumed = deps.approvals.consume(approvalId, { tool: request.toolId, inputHash });
  if (!consumed.ok) {
    const message =
      consumed.reason === 'consumed'
        ? 'That approval was already used. Approve it again to continue.'
        : consumed.reason === 'expired'
          ? 'That approval has expired. Approve it again to continue.'
          : consumed.reason === 'rejected'
            ? 'That action was declined.'
            : consumed.reason === 'mismatch'
              ? 'This action changed since you approved it, so it needs approving again.'
              : 'That approval could not be found.';
    events.push({ stage: 'failed_before_commit', at: stamp(now), approvalId, detail: consumed.reason });
    return { routed: null, events, refusal: { outcome: 'refused_policy', message } };
  }
  events.push({ stage: 'approval_consumed', at: stamp(now), approvalId });

  /*
   * Re-route with the now-consumed approval reported as VALID and bound. The
   * decision layer still re-checks the binding itself — two independent checks
   * of the same property, because this one matters.
   */
  const routed = await routeToolInvocation<TInput>(request, {
    ...deps.resolvers,
    consent: () => ({ state: 'valid', approvalId, inputHash }),
  });

  if (!routed.decision.executable) {
    events.push({ stage: 'failed_before_commit', at: stamp(now), approvalId, detail: routed.decision.blockedAt });
    return {
      routed,
      events,
      refusal: {
        outcome: routed.decision.blockedAt?.startsWith('preflight') ? 'preflight_failed' : 'refused_policy',
        message: routed.decision.reason ?? 'This action cannot run.',
      },
    };
  }

  events.push({ stage: 'dispatch_started', at: stamp(now), approvalId });
  return { routed, events };
}
