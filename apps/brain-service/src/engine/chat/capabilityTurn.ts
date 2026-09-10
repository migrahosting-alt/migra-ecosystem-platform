/**
 * ONE TURN, FROM PROMPT TO VERIFIED EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS A MODULE AND NOT PART OF THE CHAT ROUTE
 *
 * `/api/ai/chat` is already a thousand lines carrying image generation,
 * streaming, escalation and memory. Teaching it Email semantics, attachment
 * semantics, provider ids and evidence-resolution rules would make the one
 * route that every turn passes through the place where every capability's
 * details accumulate.
 *
 * So the route supplies four things — an authenticated identity, the
 * conversation and turn, the prompt, and its streaming hooks — and learns
 * nothing else. Everything below is capability-generic: nothing here names a
 * capability, and a capability registered later flows through unchanged.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A PERSISTED REFERENCE IS A POINTER, NEVER A PERMISSION
 *
 * A stored evidence id says what the user was previously shown. It does NOT
 * say they may still see it. So resolving "that email" does not serve the
 * stored text back: it re-executes the read through the capability, under the
 * CURRENT identity, against CURRENT readiness.
 *
 * That difference is the whole reason a disconnect takes effect between turns.
 * The tempting optimisation — "we already have the body, skip the round trip" —
 * silently converts the pointer into a permission token, and the mailbox the
 * user revoked keeps answering.
 */

import { executeToolCore, type ToolExecDeps } from '../tools/toolExecutor.js';
import { principalScopeOf, type ExecutionIdentity } from '../identity/executionIdentity.js';
import { selectCapabilities, type CapabilityPlan, type SelectableCapability } from '../models/capabilitySelection.js';
import { TypedEvidenceLedger } from '../grounding/typedEvidenceLedger.js';
import type { EvidenceItem } from '../grounding/evidenceTypes.js';
import {
  evidenceFromMessage, evidenceFromSearch, evidenceFromThread,
} from '../email/emailEvidenceProduction.js';
import {
  resolveReference, type ConversationEvidenceStore, type ResolvedReference,
} from './conversationEvidence.js';
import type { EmailMessage, EmailThread } from '../email/types.js';

export interface CapabilityTurnDeps {
  toolDeps: ToolExecDeps;
  /** From the registry. The turn does not know which capabilities exist. */
  capabilities: readonly SelectableCapability[];
  evidence: ConversationEvidenceStore;
}

export interface CapabilityTurnInput {
  prompt: string;
  /** 🚨 Server-derived. Null means unidentified, and nothing executes. */
  identity: ExecutionIdentity | null;
  conversationId: string;
  turnId: string;
  requestId: string;
}

export interface ExecutedCapability {
  capabilityId: string;
  op: string;
  ok: boolean;
  /** Present when the capability refused. Engine words, no provider vocabulary. */
  detail?: string;
}

export interface CapabilityTurnResult {
  plan: CapabilityPlan;
  /** Evidence this turn retrieved. Empty when nothing was selected or executed. */
  ledger: TypedEvidenceLedger;
  /** What a backward reference resolved to, if the prompt carried one. */
  reference: ResolvedReference | null;
  executed: ExecutedCapability[];
  /** Whether the caller should still plan repository evidence. */
  repoPlanning: boolean;
}

/** The scope every piece of this turn is bound to. */
const scopeOf = (identity: ExecutionIdentity) => ({
  principalId: identity.principalId,
  workspaceId: identity.workspaceId,
});

/**
 * Run the capability half of one turn.
 *
 * Returns evidence, never prose. Synthesis and verification stay with the
 * caller, because the model call and the streaming hooks live there — and
 * because an orchestrator that also wrote the answer would be two jobs.
 */
export async function runCapabilityTurn(
  input: CapabilityTurnInput,
  deps: CapabilityTurnDeps,
): Promise<CapabilityTurnResult> {
  const identified = input.identity !== null;
  const plan = selectCapabilities({
    prompt: input.prompt,
    capabilities: deps.capabilities,
    identified,
  });

  /*
   * 🚨 UNIDENTIFIED TURNS STOP HERE. The selector already refuses to choose
   * anything, and this returns an empty ledger rather than an absent one, so a
   * caller cannot mistake "nothing retrieved" for "nothing to retrieve".
   */
  if (!input.identity) {
    return {
      plan,
      ledger: new TypedEvidenceLedger({ principalId: '', workspaceId: '' }),
      reference: null,
      executed: [],
      repoPlanning: plan.repoPlanning,
    };
  }

  const scope = scopeOf(input.identity);
  const ledger = new TypedEvidenceLedger(scope);
  const executed: ExecutedCapability[] = [];

  /*
   * 🚨 SCOPED READ. The history is fetched for THIS principal; a conversation
   * id names a thread, it does not grant access to what someone else put in it.
   */
  const history = await deps.evidence.recent(input.conversationId, scope, 10);
  const reference = resolveReference({ prompt: input.prompt, history, scope });

  for (const chosen of plan.selected) {
    /*
     * 🚨 RE-EXECUTED, NOT REPLAYED. When a reference resolved, the operation
     * still goes through the capability under the current identity — the
     * stored text is a pointer to what was seen, never evidence that it may
     * still be seen.
     */
    const input_ = operationFor(input.prompt, reference);
    const outcome = await executeToolCore(deps.toolDeps, {
      tool: chosen.capabilityId,
      input: input_,
      requestId: input.requestId,
      principal: principalScopeOf(input.identity),
    });

    if (!outcome.ok) {
      executed.push({
        capabilityId: chosen.capabilityId,
        op: String(input_.op ?? 'search'),
        ok: false,
        detail: outcome.error,
      });
      continue;
    }

    executed.push({ capabilityId: chosen.capabilityId, op: String(input_.op ?? 'search'), ok: true });
    for (const item of evidenceFrom(outcome.result, scope, ledger)) {
      // A refusal here would mean production stamped a foreign scope, which is
      // a bug rather than a condition — the ledger is the second gate.
      ledger.add(item);
    }
  }

  /*
   * Persist what THIS turn retrieved, so the next turn can say "that email".
   * Ids and locators only — the ledger holds the text for this turn alone.
   */
  if (!ledger.isEmpty()) {
    await deps.evidence.append({
      conversationId: input.conversationId,
      turnId: input.turnId,
      scope,
      items: ledger.all(),
    });
  }

  return { plan, ledger, reference, executed, repoPlanning: plan.repoPlanning };
}

/**
 * What to ask the capability for.
 *
 * A resolved reference names the message; without one the prompt is a fresh
 * search. Deliberately small — deciding operations from prose is the routing
 * problem this project already deleted once, and it does not come back here.
 */
function operationFor(prompt: string, reference: ResolvedReference | null): Record<string, unknown> {
  if (reference) {
    if (reference.kind === 'thread') {
      return { op: 'readThread', threadId: reference.item.locator.providerThreadId };
    }
    if (reference.kind === 'attachment') {
      return { op: 'listAttachments', messageId: reference.item.locator.providerMessageId };
    }
    return { op: 'readMessage', messageId: reference.item.locator.providerMessageId };
  }
  return { op: 'search', keywords: prompt, limit: 20 };
}

/** Convert whatever a capability returned into evidence. */
function evidenceFrom(
  result: unknown,
  scope: { principalId: string; workspaceId: string },
  ids: { nextId(kind: 'email'): string },
): EvidenceItem[] {
  const r = (result ?? {}) as Record<string, unknown>;
  if (Array.isArray(r.messages)) {
    return evidenceFromSearch(r.messages as EmailMessage[], scope, ids);
  }
  if (r.message) {
    return [evidenceFromMessage(r.message as EmailMessage, scope, ids)];
  }
  if (r.thread) {
    return evidenceFromThread(r.thread as EmailThread, scope, ids);
  }
  return [];
}
