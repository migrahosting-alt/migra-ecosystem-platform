/**
 * MigraAI Engine — conversation summarizer.
 *
 * Compresses older completed messages into a summary. This implementation is
 * EXTRACTIVE and deterministic: it never turns a guess into a fact. It records
 * user decisions and open questions verbatim (truncated), and leaves the
 * fact/state/next-action buckets empty unless evidence is explicit — a model-
 * backed summarizer can enrich these later, but must stay source-grounded.
 *
 * It is source-bound (every summary carries the message id range it covers),
 * idempotent (re-summarizing an already-covered range returns the existing
 * summary), and threshold-gated (only runs once enough new completed messages
 * exist).
 */

import type { ConversationStore, Scope, Summary, SummaryBody } from './conversationStore.js';

export interface SummarizeResult {
  ok: boolean;
  reason?: 'not-enough-messages' | 'already-summarized' | 'unknown-conversation';
  summary?: Summary;
}

const MIN_NEW_MESSAGES = 4;

/**
 * How many of the newest completed messages are never summarised.
 *
 * They are shown verbatim by the context builder, so compressing them would put
 * a lossy copy above an exact one — and would risk summarising a fact in the
 * window where the user is still correcting it.
 *
 * 🚨 DEFAULTS TO ZERO, AND THE CALLER OPTS IN. The manual
 * `POST /…/summarize` route means "summarise what is there", and silently
 * withholding its newest turns would change what that endpoint does to every
 * existing caller. The context-pressure trigger — the one that exists to keep
 * recent turns raw — passes its own value.
 */
const DEFAULT_KEEP_RECENT = 0;
/** What the pressure trigger keeps verbatim. */
export const PRESSURE_KEEP_RECENT = 6;

export async function summarizeConversation(
  store: ConversationStore,
  scope: Scope,
  conversationId: string,
  opts: { minNewMessages?: number; force?: boolean; keepRecent?: number } = {},
): Promise<SummarizeResult> {
  if (!store.getConversation(conversationId, scope)) {
    return { ok: false, reason: 'unknown-conversation' };
  }
  const complete = store.getMessages(conversationId, scope, { status: 'complete' });
  if (complete.length === 0) return { ok: false, reason: 'not-enough-messages' };

  const latest = store.getLatestSummary(conversationId, scope);
  const lastCovered = latest?.sourceToMessageId;
  const startIndex = lastCovered ? complete.findIndex((m) => m.id === lastCovered) + 1 : 0;

  /*
   * 🚨 THE RECENT TURNS STAY RAW. Only the OLDER portion is eligible.
   *
   * Summarising up to the newest message would compress turns that are about to
   * be shown verbatim anyway — the same content twice, once exact and once
   * lossy, with the lossy copy sitting ABOVE the exact one where a model reads
   * it first. Worse, a fact corrected in the last few turns could be summarised
   * before the correction is settled.
   *
   * Recent turns are the ones context can afford to keep exactly; they are not
   * what pressure is asking us to compress.
   */
  const keepRecent = Math.max(0, opts.keepRecent ?? DEFAULT_KEEP_RECENT);
  const eligible = keepRecent > 0 ? complete.slice(0, Math.max(0, complete.length - keepRecent)) : complete;
  const range = eligible.slice(startIndex);

  // Idempotent: nothing new since the last summary.
  if (range.length === 0) {
    return { ok: false, reason: 'already-summarized', summary: latest };
  }
  const minNew = opts.minNewMessages ?? MIN_NEW_MESSAGES;
  if (!opts.force && range.length < minNew) {
    return { ok: false, reason: 'not-enough-messages' };
  }

  const from = range[0]!;
  const to = range[range.length - 1]!;
  const body: SummaryBody = { confirmedFacts: [], decisions: [], questions: [], projectState: [], nextActions: [] };
  for (const m of range) {
    if (m.role !== 'user') continue;
    const line = truncate(m.content, 160);
    if (/\?\s*$/.test(m.content.trim())) body.questions.push(line);
    else body.decisions.push(line);
  }

  /*
   * 🚨 EVERY STATEMENT IS KEPT, IN ORDER, AND THAT IS HOW A CORRECTION WINS.
   *
   * A summariser that "resolves" contradictions has to decide which of two
   * things a person said is the true one, and it decides wrong exactly when it
   * matters: an account number given early and corrected later reads as two
   * equally-weighted facts unless order is preserved. Keeping both in sequence
   * means the correction is the LAST thing said on the subject, which is what a
   * reader and a model both take it to mean — and neither the original nor the
   * correction is silently discarded.
   *
   * It is also why this summariser stays extractive. Rewriting the two into one
   * sentence is where a stale value becomes the permanent one.
   */

  /*
   * Artifacts stay REFERENCES, not prose. A file discussed in the compressed
   * range is named here so it remains addressable; what it SAYS is still the
   * file's to answer, for as long as the file exists.
   */
  const files = [...new Set(range.flatMap((m) => m.fileRefs ?? []))];
  if (files.length > 0) body.files = files;

  const summary = await store.addSummary(conversationId, scope, {
    sourceFromMessageId: from.id,
    sourceToMessageId: to.id,
    summary: body,
  });
  if (!summary) return { ok: false, reason: 'unknown-conversation' };
  return { ok: true, summary };
}

function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}
