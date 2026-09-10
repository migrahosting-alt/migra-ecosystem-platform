/**
 * THE GROUNDING GATE FOR NORMAL CHAT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS EXISTS AT ALL
 *
 * `/api/ai/answer` and the autonomous loop have verified their claims for a
 * long time. `/api/ai/chat` never has — it predates the gate, and nobody
 * noticed because until now it had no retrieved evidence of its own to be
 * wrong about. The moment a mailbox became reachable from normal chat, the
 * surface a user actually types into became the one surface with no gate on it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THERE IS NO SECOND VERIFIER HERE
 *
 * This module decides WHEN the gate runs and what happens around it. The
 * judgement itself is `verifyAnswer`, unchanged and shared — the same function,
 * the same rules, the same adapters. A chat-shaped copy of it would be the
 * two-standards problem arriving by the back door: "repo claims are checked,
 * chat claims are checked slightly differently", and the second standard is
 * always the weaker one.
 *
 * ---------------------------------------------------------------------------
 * 🚨 AND IT ENGAGES ONLY WHERE THERE IS EVIDENCE TO JUDGE
 *
 * Repository-only chat is untouched. That is not timidity: chat has never
 * verified, its answers are not built to cite, and switching the gate on for
 * every turn at the same time as introducing it would make any regression
 * impossible to attribute. The gate arrives with the evidence it was built for.
 */

import { EvidenceLedger } from '../grounding/evidenceLedger.js';
import { verifyAnswer, type VerificationSources } from '../grounding/claimVerifier.js';
import type { TypedEvidenceLedger } from '../grounding/typedEvidenceLedger.js';
import type { ChatCapabilityOutcome } from './chatCapabilities.js';

/** Repository chunks the chat route retrieved, in the shape it holds them. */
export interface RagChunk {
  path: string;
  startLine: number;
  endLine: number;
  snippet: string;
}

/**
 * The sources for this turn, or null when the gate does not engage.
 *
 * 🚨 REPOSITORY CHUNKS GO IN TOO, whenever the gate is running. A turn that
 * retrieved both a mailbox and source files must have BOTH judged by the same
 * verifier — otherwise a repo sentence in a mixed answer would be unsupported
 * for the sole reason that its evidence was never handed over, and the gate
 * would delete a true sentence about a file the run really read.
 */
export function chatGroundingFor(input: {
  capability: ChatCapabilityOutcome | null;
  ragChunks?: readonly RagChunk[] | undefined;
}): VerificationSources | null {
  const other = input.capability?.turn.ledger;
  if (!other || other.isEmpty()) return null;

  const repo = new EvidenceLedger();
  for (const chunk of input.ragChunks ?? []) {
    if (!chunk.path) continue;
    repo.notePath(chunk.path);
    repo.recordRead(chunk.path, chunk.startLine, chunk.endLine, chunk.snippet);
  }
  return { repo, other };
}

export interface VerifiedChatAnswer {
  /** What the user may see. Never the raw model text when the gate ran. */
  text: string;
  /** True when nothing survived as direct evidence. */
  refused: boolean;
  /** How many statements were removed. Telemetry only — never content. */
  removed: number;
  /** Set when the gate itself failed. The turn is refused, not waved through. */
  error?: string;
}

/**
 * Run the shared gate over a completed answer.
 *
 * 🚨 FAILS CLOSED. A verifier that throws must not hand back the model's raw
 * text — that is the one outcome where an unchecked answer reaches a user while
 * every log line says grounding is on. An exception here is a bug in the gate,
 * and a bug in the gate is not permission to skip it.
 */
export function verifyChatAnswer(raw: string, sources: VerificationSources): VerifiedChatAnswer {
  try {
    const verified = verifyAnswer(raw, sources);
    return {
      text: stripEvidenceLabels(verified.answer, sources.other),
      refused: verified.refused,
      removed: verified.rejected.length,
    };
  } catch (error) {
    return {
      text: 'I could not verify that answer against the evidence I retrieved, so I am not going to show it. '
        + 'Please ask again.',
      refused: true,
      removed: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Internal evidence ids, out of anything a person reads.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS IS NOT COSMETIC
 *
 * A model wrote "I've retrieved the message from [email_1]…" to a user. An
 * evidence id is implementation metadata: it identifies a row in a ledger that
 * exists for the length of one request, it means nothing to a reader, and it
 * looks enough like a citation to be trusted as one.
 *
 * 🚨 STRIPPED, NOT TRANSLATED. Turning `[email_1]` into the message it names
 * looks friendlier and is worse: the model may equally have invented
 * `[email_7]`, and translating would MANUFACTURE a citation to evidence that
 * was never involved. Removing a label costs a reader nothing — the human
 * description is already in the sentence beside it.
 *
 * Both the ledger's real ids and the id SHAPE are removed, because the leak to
 * protect against is a model inventing one it was never given.
 */
export function stripEvidenceLabels(text: string, ledger?: TypedEvidenceLedger): string {
  const ids = new Set((ledger?.all() ?? []).map((i) => i.id));
  let out = text;

  for (const id of ids) {
    out = out.replace(new RegExp(`\\s*[\\[(]\\s*${escapeRegExp(id)}\\s*[\\])]`, 'g'), '');
    out = out.replace(new RegExp(`\\b${escapeRegExp(id)}\\b`, 'g'), '');
  }
  // The shape itself, for an id this run never issued.
  out = out.replace(/\s*[[(]\s*(?:repo|email|file)_\d+\s*[\])]/g, '');
  out = out.replace(/\b(?:repo|email|file)_\d+\b/g, '');

  // Tidy the holes the removals leave, without touching paragraph breaks.
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/[ \t]+$/gm, '');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
