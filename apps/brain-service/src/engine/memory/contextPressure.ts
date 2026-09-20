/**
 * When is a conversation actually running out of room?
 *
 * 🚨 PRESSURE, NOT A TURN COUNT. "Summarise every N messages" compresses short
 * conversations that never needed it and leaves long ones — a handful of large
 * documents and workbook dumps — past the ceiling while the counter says four.
 * The thing that hurts is TOKENS, so tokens are what this measures.
 *
 * WHY THIS EXISTS AT ALL. `summarizeConversation` worked and was reachable only
 * through a route the consumer never called, so `getLatestSummary` found nothing
 * in production and the compression half of context management was dead code.
 * Once a conversation outgrew the budget its beginning was simply gone. This is
 * the trigger that was missing.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It never decides that summarising SUCCEEDED,
 * and it never removes anything. If summarisation fails or is skipped, the
 * context builder still marks the turns it could not fit — an honest gap rather
 * than a pretence of memory.
 */

import { estimateTokens } from './contextBuilder.js';
import type { ConversationStore, Scope } from './conversationStore.js';
import { VISIBLE_PARTIAL_STATUSES } from './conversationStore.js';

/**
 * The share of the budget at which older turns should be compressed.
 *
 * Below the ceiling on purpose: waiting until the budget is exceeded means the
 * first turn to feel it has ALREADY lost history, and a summary written then
 * arrives one turn too late to have helped.
 */
export const PRESSURE_RATIO = 0.75;

/** The context builder's own default, so the two cannot drift apart. */
export const DEFAULT_TOKEN_BUDGET = 3000;

export interface PressureReading {
  /** Tokens the recent raw window would cost right now. */
  estimatedTokens: number;
  /** The high-water mark this is measured against. */
  threshold: number;
  /** True when older turns should be compressed. */
  underPressure: boolean;
  /** How many completed messages exist — reported, never used as the trigger. */
  messageCount: number;
}

/**
 * Measure, and say what was measured.
 *
 * Returns a reading rather than a bare boolean so a caller can log WHY it did or
 * did not summarise. A trigger nobody can inspect is one nobody can debug when a
 * conversation mysteriously forgets something.
 */
export function readContextPressure(
  store: ConversationStore,
  scope: Scope,
  conversationId: string,
  tokenBudget: number = DEFAULT_TOKEN_BUDGET,
): PressureReading {
  const threshold = Math.floor(tokenBudget * PRESSURE_RATIO);
  const messages = store.getMessages(conversationId, scope, {
    // The same set the context builder would show, so this measures the real
    // cost rather than a different conversation's worth of text.
    status: ['complete', ...VISIBLE_PARTIAL_STATUSES],
    limit: 20,
  });
  const estimatedTokens = messages.reduce((total, m) => total + estimateTokens(m.content), 0);
  return {
    estimatedTokens,
    threshold,
    underPressure: estimatedTokens > threshold,
    messageCount: messages.length,
  };
}
