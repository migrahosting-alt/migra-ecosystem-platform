/**
 * MigraAI Engine — context builder.
 *
 * The ENGINE (not the client) decides what prior context enters the model window.
 * For a turn it assembles, within a token budget:
 *
 *   system instructions + relevant workspace memory + latest summary
 *     + bounded recent messages + current request
 *
 * It returns sanitized DIAGNOSTICS (what was included / omitted / estimated
 * tokens) so retrieval is explainable — never the hidden prompt or any reasoning.
 */

import { VISIBLE_PARTIAL_STATUSES } from './conversationStore.js';
import type { ConversationStore, Scope, Summary } from './conversationStore.js';

export interface BuiltContextMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ContextDiagnostics {
  conversationId?: string;
  recentMessagesIncluded: number;
  summaryUsed: boolean;
  workspaceMemoriesUsed: number;
  estimatedTokens: number;
  omittedForBudget: number;
}

export interface BuiltContext {
  messages: BuiltContextMessage[];
  diagnostics: ContextDiagnostics;
  /** Compact conversationSummary string for backends that take one (legacy path). */
  summaryText: string;
}

/** Rough token estimate (chars/4). Good enough for budgeting a local window. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * The universal assistant identity for memory-backed turns.
 *
 * Deliberately SHORT. This string is pushed first into a token-budgeted
 * context, so every character here displaces workspace memory: an earlier
 * attempt to carry the full persona and language policy in this constant
 * squeezed the memories out and broke the budget test that proves they fit.
 *
 * The full persona — including the Haitian Creole language rule — lives where
 * it costs nothing, in the provider's system message
 * (`providers/openAiCompatProvider.ts`), selected by `systemPromptId`.
 */
const SYSTEM =
  "You are MigraPilot, a helpful general-purpose AI assistant. Always reply in the user's own language. Use the provided context; do not invent facts.";

export function renderSummary(summary: Summary): string {
  const s = summary.summary;
  const parts: string[] = [];
  if (s.confirmedFacts.length) parts.push(`Confirmed facts:\n- ${s.confirmedFacts.join('\n- ')}`);
  if (s.decisions.length) parts.push(`Decisions:\n- ${s.decisions.join('\n- ')}`);
  if (s.questions.length) parts.push(`Open questions:\n- ${s.questions.join('\n- ')}`);
  if (s.projectState.length) parts.push(`Project state:\n- ${s.projectState.join('\n- ')}`);
  if (s.nextActions.length) parts.push(`Next actions:\n- ${s.nextActions.join('\n- ')}`);
  return `Summary of earlier conversation (messages ${summary.sourceFromMessageId}‥${summary.sourceToMessageId}):\n${parts.join('\n')}`;
}

export interface BuildContextOptions {
  store: ConversationStore;
  scope: Scope;
  conversationId?: string;
  currentPrompt: string;
  retrieve: boolean;
  tokenBudget?: number;
}

export function buildContext(opts: BuildContextOptions): BuiltContext {
  const budget = opts.tokenBudget ?? 3000;
  const messages: BuiltContextMessage[] = [{ role: 'system', content: SYSTEM }];
  const diagnostics: ContextDiagnostics = {
    conversationId: opts.conversationId,
    recentMessagesIncluded: 0,
    summaryUsed: false,
    workspaceMemoriesUsed: 0,
    estimatedTokens: estimateTokens(SYSTEM),
    omittedForBudget: 0,
  };

  const push = (m: BuiltContextMessage): boolean => {
    const cost = estimateTokens(m.content);
    if (diagnostics.estimatedTokens + cost > budget) {
      diagnostics.omittedForBudget += 1;
      return false;
    }
    messages.push(m);
    diagnostics.estimatedTokens += cost;
    return true;
  };

  let summaryText = '';

  if (opts.retrieve && opts.conversationId) {
    // Workspace memory (highest-confidence, bounded).
    const memos = opts.store.getWorkspaceMemories(opts.scope);
    for (const memo of memos) {
      if (push({ role: 'system', content: `Workspace memory (${memo.category}): ${memo.content}` })) {
        diagnostics.workspaceMemoriesUsed += 1;
      }
    }

    // Latest summary (compressed older history).
    const summary = opts.store.getLatestSummary(opts.conversationId, opts.scope);
    if (summary) {
      summaryText = renderSummary(summary);
      if (push({ role: 'system', content: summaryText })) diagnostics.summaryUsed = true;
    }

    /*
     * Bounded recent messages, newest-first for budgeting then re-ordered.
     *
     * 🚨 STOPPED ANSWERS ARE INCLUDED, AND MARKED. They used to be excluded with
     * everything that was not `complete`, which meant text still on the user's
     * screen was invisible to the next turn — so "carry on from where you
     * stopped" was unanswerable about the very thing they were looking at.
     *
     * Including them unmarked would be the opposite error and a worse one: the
     * model would read a truncated answer as a finished one and build on a
     * conclusion that was never reached. So they travel WITH their limitation
     * attached, below.
     */
    const recent = opts.store.getMessages(opts.conversationId, opts.scope, {
      status: ['complete', ...VISIBLE_PARTIAL_STATUSES],
      limit: 20,
    });
    const selected: BuiltContextMessage[] = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const m = recent[i];
      if (!m || m.role === 'system') continue;
      const cost = estimateTokens(m.content);
      if (diagnostics.estimatedTokens + cost > budget) {
        /*
         * 🚨 MARK THE GAP. DO NOT LEAVE ONE, AND DO NOT THROW THE REST AWAY.
         *
         * This used to `continue` silently, which handed the model a transcript
         * with a HOLE in it as though it were continuous: a long turn 3
         * vanished and "turn 2: noted" sat directly before "turn 4:
         * acknowledged", so the assistant appeared to have acknowledged
         * something that was not there. Measured exactly that way.
         *
         * Stopping outright would fix the false adjacency and cost more than it
         * needs to — an account number in turn 1 that fits easily would be
         * dropped because turn 3 was long. So the oversized turn is replaced by
         * a marker IN ITS PLACE and the walk continues. Nothing is adjacent to
         * anything it was not adjacent to, and everything that fits is kept.
         */
        diagnostics.omittedForBudget += 1;
        const marker = '[A long message here was left out because it did not fit. Ask the user about it if it matters.]';
        const markerCost = estimateTokens(marker);
        if (diagnostics.estimatedTokens + markerCost <= budget) {
          diagnostics.estimatedTokens += markerCost;
          selected.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: marker });
        }
        continue;
      }
      diagnostics.estimatedTokens += cost;
      selected.push({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        // The mark is what makes including it safe. Stated in the transcript
        // itself rather than out of band, because the model only ever sees this.
        /*
         * The mark names WHICH kind of unfinished, because the two are different
         * facts about the user. A stop is a decision; an interruption happened
         * TO them, and telling the model they chose it would be a small lie
         * about a person who is right there to be contradicted.
         */
        content: m.status === 'stopped'
          ? `${m.content}\n\n[This answer was stopped by the user before it finished.]`
          : m.status === 'interrupted'
            ? `${m.content}\n\n[This answer was cut off before it finished and is incomplete.]`
            : m.content,
      });
    }
    selected.reverse();
    /*
     * AND SAY SO. A contiguous window is still a PARTIAL one, and a model that
     * is not told it is missing earlier turns will answer "you never mentioned
     * that" with total confidence about a conversation it was only shown the
     * end of. The count is deliberately not given: it is an estimate over a
     * capped read, and a precise-sounding number nobody can verify is worse
     * than the plain fact.
     */
    for (const m of selected) messages.push(m);
    diagnostics.recentMessagesIncluded = selected.length;
  }

  // The current request always goes in.
  messages.push({ role: 'user', content: opts.currentPrompt });
  diagnostics.estimatedTokens += estimateTokens(opts.currentPrompt);

  return { messages, diagnostics, summaryText };
}
