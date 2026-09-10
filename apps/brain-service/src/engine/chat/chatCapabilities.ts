/**
 * THE ONE PLACE NORMAL CHAT MEETS A CAPABILITY.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY A LATE BINDING RATHER THAN A PARAMETER
 *
 * `registerAiRoutes` already takes twelve positional arguments, and the tool
 * dependencies it would need are constructed AFTER it is called. Threading a
 * thirteenth through would mean reordering server startup to satisfy a
 * signature — the kind of change that looks harmless and moves the point at
 * which a mailbox becomes reachable.
 *
 * So this binds the way email execution already does in this codebase: one
 * call, made once startup has everything, and an unbound engine simply has no
 * capabilities in chat. That is also the honest default for a deployment that
 * has not wired them.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not write prose, choose a model, or touch streaming. It returns
 * evidence and a plan; the route keeps every decision it already owned. The
 * whole reason the orchestration lives in `capabilityTurn` is that the chat
 * route must not become the place capability details accumulate.
 */

import type { ToolExecDeps } from '../tools/toolExecutor.js';
import { adapterFor } from '../grounding/evidenceTypes.js';
import { executionIdentityFrom } from '../identity/executionIdentity.js';
import { runCapabilityTurn, type CapabilityTurnResult } from './capabilityTurn.js';
import type { ConversationEvidenceStore } from './conversationEvidence.js';

export interface ChatCapabilityBinding {
  /**
   * 🚨 THE CATALOG COMES FROM THESE DEPS, not from a registry passed beside
   * them. Two references could be two instances, and then chat would select
   * from one catalog while dispatch executed against another — a capability
   * visible to the selector and unknown to the executor, or the reverse.
   */
  toolDeps: ToolExecDeps;
  evidence: ConversationEvidenceStore;
}

let binding: ChatCapabilityBinding | null = null;

export function bindChatCapabilities(next: ChatCapabilityBinding | null): void {
  binding = next;
}

/** Test seam. Asserting the wiring without asserting the whole server. */
export function __chatCapabilityBindingForTest(): ChatCapabilityBinding | null {
  return binding;
}

/**
 * A chat turn's capability outcome, plus the words for anything that could not
 * run.
 *
 * 🚨 THE UNAVAILABLE ONES ARE PART OF THE ANSWER. A user who asks about their
 * inbox and has not connected one must be told that — not answered from the
 * model's own knowledge, and not met with silence. The selector filters an
 * unavailable capability out before anything executes, so without carrying the
 * fact forward the turn is indistinguishable from one that was never about mail.
 */
export interface ChatCapabilityOutcome {
  turn: CapabilityTurnResult;
  /**
   * Capabilities the request WAS about and that could not run, in the engine's
   * own words. Never a provider, host or version: infrastructure describing
   * itself to a user is a defect this codebase has shipped once already.
   */
  unavailable: Array<{ displayName: string; reason: string }>;
}

/**
 * Run the capability half of a chat turn, or return null when there is none.
 *
 * Null means "this engine has no capabilities wired" and is not the same as an
 * empty result, which means "capabilities exist and none applied". The route
 * treats them the same; the distinction matters to anyone reading a trace.
 */
export async function runChatCapabilities(input: {
  prompt: string;
  scope: { owner: string; workspace: string };
  conversationId: string;
  turnId: string;
  requestId: string;
}): Promise<ChatCapabilityOutcome | null> {
  if (!binding) return null;

  /*
   * 🚨 REFUSED FOR AN UNUSABLE SCOPE RATHER THAN PATCHED. `executionIdentityFrom`
   * returns null when either half is empty; an identity assembled from a blank
   * is not a weaker identity, it is a different principal — and a mailbox read
   * under one is a cross-tenant read with extra steps.
   */
  const identity = executionIdentityFrom(input.scope);

  /*
   * 🚨 THE CATALOG IS GLOBAL; AVAILABILITY IS NOT.
   *
   * `includeUnavailable` asks the registry for everything it knows about, and
   * the readiness context resolved for THIS principal decides what is usable.
   * Taking a context-free listing instead would answer "is email available?"
   * from process-wide state — the same answer for everyone, reflecting whoever
   * connected most recently.
   */
  const principal = identity ? { owner: identity.principalId, workspace: identity.workspaceId } : null;
  const readiness = principal ? (await binding.toolDeps.readinessFor?.(principal) ?? {}) : {};
  const catalog = binding.toolDeps.registry.list({ includeUnavailable: true }, readiness);
  const capabilities = catalog.map((d) => ({ id: d.id, nouns: d.nouns, available: d.available }));

  const turn = await runCapabilityTurn({
    prompt: input.prompt,
    identity,
    conversationId: input.conversationId,
    turnId: input.turnId,
    requestId: input.requestId,
  }, { toolDeps: binding.toolDeps, capabilities, evidence: binding.evidence });

  /*
   * 🚨 ONLY FOR AN IDENTIFIED CALLER. An unidentified request is rejected for
   * the same reason and must NOT be told which of its own accounts is or is not
   * connected — the selector deliberately makes those two rejections
   * indistinguishable from the outside, and this must not undo that.
   *
   * 🚨 AND ONLY WHERE A NOUN MATCHED. `evidence` is present on a rejection only
   * when the request actually named this capability's own word. Without that
   * check, every unavailable capability would announce itself on every prompt.
   */
  const unavailable = turn.identified
    ? turn.plan.rejected
      .filter((r) => r.reason === 'capability-unavailable' && r.evidence)
      .map((r) => catalog.find((d) => d.id === r.capabilityId))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => ({
        displayName: d.displayName,
        // The engine's own sentence. A client that wrote its own excuse would
        // be guessing at a state only the engine can see.
        reason: d.unavailableReason ?? 'It is not available right now.',
      }))
    : [];

  return { turn, unavailable };
}

/**
 * What the model is told about what was retrieved.
 *
 * 🚨 EVIDENCE AND ITS LIMITS TRAVEL TOGETHER. A preview reads exactly like a
 * full message once it is prose, and a truncated spreadsheet reads exactly like
 * a whole one. The caveats are attached here, where the completeness flags
 * still exist, rather than asked of the model — which would be asking it to
 * remember something it was never told.
 */
export function capabilityContext(outcome: ChatCapabilityOutcome): string {
  const result = outcome.turn;
  /*
   * 🚨 A POINTED-AT NOTHING IS AN INSTRUCTION TO ASK, NOT A LICENCE TO LOOK.
   * "Summarize that email" with no antecedent means the user believes we are
   * already looking at something. Answering from a fresh search would answer a
   * question they did not ask.
   */
  if (result.unresolvedReference) {
    return `The request refers to "${result.unresolvedReference.phrase}", and this conversation `
      + 'holds nothing that it points to. Ask which one they mean. Do NOT search, and do not '
      + 'guess at what they might have meant.';
  }

  if (result.ambiguousAttachment) {
    const names = result.ambiguousAttachment.candidates.map((c) => `"${c}"`).join(', ');
    return `The message carries more than one attachment (${names}) and the request names one. `
      + 'Ask which. Do NOT pick one.';
  }

  const items = result.ledger.all();
  if (items.length === 0) {
    /*
     * Executed and found nothing is a FACT, and a different one from never
     * having looked. Left unsaid, the model fills the silence from its own
     * knowledge and the answer describes a mailbox nobody opened.
     */
    /*
     * 🚨 "NOT CONNECTED" IS AN ANSWER, AND THE ONE THE USER NEEDS.
     *
     * Asked to search an inbox that is not connected, the turn executes
     * nothing — and told nothing, the model answers from its own knowledge and
     * writes a confident paragraph about a mailbox that was never opened. This
     * is what makes the state visible instead.
     */
    if (outcome.unavailable.length > 0) {
      return outcome.unavailable
        .map((u) => `${u.displayName} is not available for this user: ${u.reason} `
          + 'Tell them plainly and do not answer the request from your own knowledge.')
        .join('\n');
    }

    const attempted = result.executed.length > 0;
    if (!attempted) return '';
    const refused = result.executed.find((e) => !e.ok);
    return refused
      ? `A connected source could not be read: ${refused.detail ?? 'it refused the request'}. `
        + 'Say so plainly. Do not answer as though it had been read.'
      : 'The connected source was searched and returned nothing. Say that nothing was found — '
        + 'do not fill the gap from your own knowledge.';
  }

  /*
   * 🚨 NO EVIDENCE IDS IN THE TEXT. They were prefixed as `[email_1]` and the
   * model echoed one straight into an answer — "I've retrieved the message from
   * [email_1]…". An internal handle is meaningless to a reader, and this route
   * has no verifier downstream to rewrite citations out of the prose, so
   * whatever goes in comes out. The human-readable description is the citation.
   */
  const lines = items.map((item) => {
    const adapter = adapterFor(item);
    return `${adapter.describe(item as never)}:\n${item.text}`;
  });

  /*
   * 🚨 WHAT THE PROVIDER MATCHED IS NOT WHAT THE MESSAGE SAYS.
   *
   * A mail provider indexes attachment content, so a search can return exactly
   * the right message while nothing in the body mentions the term. Left unsaid,
   * the model writes the obvious sentence — "the email contains X" — the gate
   * removes it as unsupported, and the user is told nothing was found about a
   * search that found the right message.
   *
   * So the difference is stated, and the attachment evidence below is where the
   * term actually is. What the model may say afterwards is about a FILE this
   * turn opened, never about a body it did not.
   */
  const match = result.providerMatchBeyondEvidence;
  const provenance = match
    ? [
      `The mail provider returned this message for ${match.terms.map((t) => `"${t}"`).join(', ')}, `
      + 'but those words are NOT in the message text — providers also match on attachment contents. '
      + (match.inspected.length > 0
        ? `The attachment(s) ${match.inspected.map((f) => `"${f}"`).join(', ')} were opened and read; their contents are below.`
        : 'No attachment could be opened to check.')
      + (match.located
        ? ' Say where the term was found, and attribute it to that file rather than to the message body.'
        : ' The term was not found in anything that could be read. Say that the provider matched the message '
          + 'but the term was not located in what could be opened — do NOT say the message contains it.'),
    ]
    : [];

  const limits = result.ledger.limitations();
  return [
    ...provenance,
    'Retrieved from the user\'s own connected sources for THIS request. State facts about them '
    + 'only where these say so, and quote values exactly as they appear:',
    ...lines,
    ...(limits.length > 0 ? ['', ...limits.map((l) => `NOTE: ${l}`)] : []),
  ].join('\n\n');
}
