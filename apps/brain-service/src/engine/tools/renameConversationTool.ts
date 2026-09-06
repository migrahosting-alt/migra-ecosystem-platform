/**
 * THE FIRST MUTATING TOOL — rename a conversation.
 *
 * Chosen because it is internal, reversible, already backed by real persistence
 * (`ConversationStore.renameConversation`), and involves no connector or account.
 * That isolates what this slice is proving: the consent lifecycle, exact-input
 * binding, replay refusal, and honest reporting when the outcome is unknown.
 *
 * ---------------------------------------------------------------------------
 * WHY UNCERTAINTY IS RESOLVED BY LOOKING, NOT BY GUESSING
 *
 * A rename is naturally idempotent: setting the title to "Y" twice leaves it
 * "Y". So when a dispatch fails indeterminately, this READS THE CONVERSATION
 * BACK. If the title already equals the target, the write committed and the
 * outcome is `success`. Only when the read also fails is the outcome genuinely
 * `outcome_unknown_after_dispatch`.
 *
 * That is the whole discipline in one place: observe before concluding, and
 * report unknown only when observation itself is unavailable — rather than
 * picking whichever of "failed" or "succeeded" is more convenient.
 *
 * The read-back also serves the plain success path. A mutation that reports
 * success without confirming the persisted state is asserting an outcome it did
 * not verify, which is the same defect one layer down.
 * ---------------------------------------------------------------------------
 */

import type { Conversation, Scope } from '../memory/conversationStore.js';
import {
  isIndeterminate,
  type DispatchStage,
  type MutationOutcome,
} from './mutationOutcome.js';
import type { PreflightFact, RoutedDecision } from './toolRouter.js';

export interface RenameConversationInput {
  conversationId: string;
  title: string;
}

/** What the store does to a title, mirrored so the hash binds what persists. */
const STORE_TITLE_LIMIT = 200;

/**
 * Normalize to EXACTLY what the backend will store.
 *
 * The store truncates to 200 characters. If normalization did not mirror that,
 * the user would approve a 260-character title, a 200-character one would be
 * written, and the approval would have bound a string that never existed.
 */
export function normalizeRename(input: RenameConversationInput): RenameConversationInput {
  return {
    conversationId: input.conversationId.trim(),
    title: input.title.trim().replace(/\s+/g, ' ').slice(0, STORE_TITLE_LIMIT),
  };
}

export interface RenamePreflightDeps {
  /** Reads the conversation, scope-checked. Side-effect free. */
  getConversation(id: string, scope: Scope): Conversation | undefined;
  scope: Scope;
}

/**
 * Everything knowable without a side effect, so consent is never sought for an
 * action already known to fail — and so the confirmation can name the real
 * before-and-after rather than the raw request.
 */
export function preflightRename(
  input: RenameConversationInput,
  deps: RenamePreflightDeps,
): PreflightFact & { preview?: string; currentTitle?: string } {
  if (!input.conversationId) return { state: 'failed', reason: 'No conversation was specified.' };
  if (input.title.length === 0) return { state: 'failed', reason: 'A conversation needs a title.' };

  const conv = deps.getConversation(input.conversationId, deps.scope);
  if (!conv) {
    // Scope-checked by the store, so "not yours" and "not there" are one answer
    // on purpose: distinguishing them would confirm the existence of other
    // people's conversations.
    return { state: 'failed', reason: 'That conversation could not be found.' };
  }
  if (conv.title === input.title) {
    /*
     * Not a failure and not worth an approval dialog: the requested state is
     * already the actual state. Asking someone to approve a change that changes
     * nothing spends their attention for no reason.
     */
    return { state: 'failed', reason: 'That is already the conversation’s title.', currentTitle: conv.title };
  }
  return {
    state: 'passed',
    currentTitle: conv.title,
    // The confirmation shows the NORMALIZED mutation that will actually run.
    preview: `Rename this conversation from “${conv.title}” to “${input.title}”`,
  };
}

export interface RenameProvenance {
  decisionId: string;
  invocationId: string;
  capability: string;
  tool: string;
  authorizationBasis: string | null;
  connectionState: string;
  normalizedInputHash: string | null;
  preflightOutcome: string;
  /** The consent that authorised THIS exact mutation. Null when none was reached. */
  consentId: string | null;
  backend: string;
  /** approved → dispatch_started → committed | failed_before_commit | outcome_unknown */
  stage: DispatchStage;
  startedAt: string;
  completedAt: string;
  outcome: MutationOutcome;
  /** Idempotency key offered to the backend, so a retry can be recognised. */
  idempotencyKey: string;
}

export interface RenameResult {
  outcome: MutationOutcome;
  /** The PERSISTED state after a success, read back — never the requested value. */
  conversation?: { id: string; title: string };
  message?: string;
  provenance: RenameProvenance;
}

export interface RenameExecuteDeps extends RenamePreflightDeps {
  renameConversation(id: string, scope: Scope, title: string): Promise<Conversation | undefined>;
  now?: () => number;
  mkInvocationId?: () => string;
}

export async function executeRename(
  routed: RoutedDecision<RenameConversationInput>,
  deps: RenameExecuteDeps,
): Promise<RenameResult> {
  const now = deps.now ?? (() => Date.now());
  const invocationId = (deps.mkInvocationId ?? (() => `inv_${Math.random().toString(36).slice(2, 12)}`))();
  const startedAt = new Date(now()).toISOString();

  const record = (stage: DispatchStage, outcome: MutationOutcome): RenameProvenance => ({
    decisionId: routed.decisionId,
    invocationId,
    capability: routed.decision.capability,
    tool: routed.decision.toolId,
    authorizationBasis: routed.authorizationState?.basis ?? null,
    connectionState: routed.connectionState.state,
    normalizedInputHash: routed.inputHash,
    preflightOutcome: routed.preflightState.state,
    consentId: routed.consentState.approvalId ?? null,
    backend: 'conversation-store',
    stage,
    startedAt,
    completedAt: new Date(now()).toISOString(),
    outcome,
    // The invocation id doubles as the idempotency key: one attempt, one key.
    idempotencyKey: invocationId,
  });

  if (!routed.decision.executable) {
    const outcome: MutationOutcome =
      routed.decision.blockedAt === 'preflight:failed' || routed.decision.blockedAt === 'preflight:not-run'
        ? 'preflight_failed'
        : 'refused_policy';
    /*
     * Blocked BEFORE anything was dispatched, so the stage is `approved` only
     * when consent actually existed. A refusal at the consent gate never reached
     * approval at all.
     */
    return {
      outcome,
      message: routed.decision.reason ?? 'This rename cannot run.',
      provenance: record('failed_before_commit', outcome),
    };
  }

  const input = routed.normalizedInput;
  if (!input) {
    return {
      outcome: 'backend_failed_before_side_effect',
      message: 'The rename could not run. Please try again.',
      provenance: record('failed_before_commit', 'backend_failed_before_side_effect'),
    };
  }

  try {
    const updated = await deps.renameConversation(input.conversationId, deps.scope, input.title);
    if (!updated) {
      // The store answered: no such conversation. A clear no, safe to retry.
      return {
        outcome: 'backend_failed_before_side_effect',
        message: 'That conversation could not be found.',
        provenance: record('failed_before_commit', 'backend_failed_before_side_effect'),
      };
    }
    /*
     * READ BACK. Reporting success from the value we sent would assert an
     * outcome nobody verified; this reports what is actually stored.
     */
    const persisted = deps.getConversation(input.conversationId, deps.scope);
    if (!persisted || persisted.title !== input.title) {
      return {
        outcome: 'outcome_unknown_after_dispatch',
        message: 'The rename was sent but could not be confirmed. Check the conversation before trying again.',
        provenance: record('outcome_unknown', 'outcome_unknown_after_dispatch'),
      };
    }
    return {
      outcome: 'success',
      conversation: { id: persisted.id, title: persisted.title },
      provenance: record('committed', 'success'),
    };
  } catch (error) {
    if (!isIndeterminate(error)) {
      return {
        outcome: 'backend_failed_before_side_effect',
        message: 'That rename was refused. Nothing was changed.',
        provenance: record('failed_before_commit', 'backend_failed_before_side_effect'),
      };
    }
    /*
     * Indeterminate. A rename is idempotent, so LOOK before concluding: if the
     * stored title already equals the target, the write committed and the
     * uncertainty is resolved by observation rather than by preference.
     */
    try {
      const after = deps.getConversation(input.conversationId, deps.scope);
      if (after && after.title === input.title) {
        return {
          outcome: 'success',
          conversation: { id: after.id, title: after.title },
          provenance: record('committed', 'success'),
        };
      }
      if (after) {
        // Observed, and it did NOT take effect. That is a clean failure.
        return {
          outcome: 'backend_failed_before_side_effect',
          message: 'The rename did not go through. Nothing was changed.',
          provenance: record('failed_before_commit', 'backend_failed_before_side_effect'),
        };
      }
    } catch {
      // The read failed too; genuinely unknown. Fall through.
    }
    return {
      outcome: 'outcome_unknown_after_dispatch',
      message: 'The rename was sent but could not be confirmed. Check the conversation before trying again.',
      provenance: record('outcome_unknown', 'outcome_unknown_after_dispatch'),
    };
  }
}
