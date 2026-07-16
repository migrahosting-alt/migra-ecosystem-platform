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

const SYSTEM = 'You are MigraPilot, a workspace-aware assistant. Use the provided context; do not invent facts.';

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

    // Bounded recent COMPLETE messages, newest-first for budgeting then re-ordered.
    const recent = opts.store.getMessages(opts.conversationId, opts.scope, { status: 'complete', limit: 20 });
    const selected: BuiltContextMessage[] = [];
    for (let i = recent.length - 1; i >= 0; i -= 1) {
      const m = recent[i];
      if (!m || m.role === 'system') continue;
      const cost = estimateTokens(m.content);
      if (diagnostics.estimatedTokens + cost > budget) {
        diagnostics.omittedForBudget += 1;
        continue;
      }
      diagnostics.estimatedTokens += cost;
      selected.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
    }
    selected.reverse();
    for (const m of selected) messages.push(m);
    diagnostics.recentMessagesIncluded = selected.length;
  }

  // The current request always goes in.
  messages.push({ role: 'user', content: opts.currentPrompt });
  diagnostics.estimatedTokens += estimateTokens(opts.currentPrompt);

  return { messages, diagnostics, summaryText };
}
