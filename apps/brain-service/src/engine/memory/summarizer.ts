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

export function summarizeConversation(
  store: ConversationStore,
  scope: Scope,
  conversationId: string,
  opts: { minNewMessages?: number; force?: boolean } = {},
): SummarizeResult {
  if (!store.getConversation(conversationId, scope)) {
    return { ok: false, reason: 'unknown-conversation' };
  }
  const complete = store.getMessages(conversationId, scope, { status: 'complete' });
  if (complete.length === 0) return { ok: false, reason: 'not-enough-messages' };

  const latest = store.getLatestSummary(conversationId, scope);
  const lastCovered = latest?.sourceToMessageId;
  const startIndex = lastCovered ? complete.findIndex((m) => m.id === lastCovered) + 1 : 0;
  const range = complete.slice(startIndex);

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

  const summary = store.addSummary(conversationId, scope, {
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
