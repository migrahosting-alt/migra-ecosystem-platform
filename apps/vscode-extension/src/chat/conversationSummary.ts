// Conversation-summary construction — the ONE place that renders prior turns into
// the compact `conversationSummary` string the brain consumes.
//
// This lives in its own vscode-free module so it is unit-testable under
// `node --test` (chatEngine imports the `vscode` API, which is unavailable there).
//
// CONTRACT: the summary must carry the ACTUAL prior turns — including what the
// ASSISTANT said — so a follow-up like "continue with the plan you proposed" can
// be answered. Blanking the assistant to "assistant: previous response" gave the
// model amnesia across turns (it could not recall its own plan). Per-turn clipping
// keeps one long answer from crowding out the rest; the total budget keeps the
// NEWEST turns (which a "continue …" follow-up depends on) when history overflows.

const MAX_SUMMARY_TURNS = 8;
const PER_TURN_CHARS = 1400;
const TOTAL_SUMMARY_CHARS = 7000;

/** Collapse intra-line whitespace and clip a single turn's text to a bound. */
function clipTurn(text: string, max: number): string {
  const t = text.trim().replace(/[ \t]+/g, ' ');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** Join role-tagged lines newest-first within a total budget, then restore
 * chronological order — so an over-long history keeps its MOST RECENT turns
 * (which a "continue …" follow-up depends on) rather than truncating the tail. */
function capToBudget(lines: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (kept.length > 0 && used + line.length + 1 > budget) break;
    kept.push(line);
    used += line.length + 1;
  }
  return kept.reverse().join('\n');
}

/** Extract the assistant's rendered markdown from a VS Code response turn's
 * `response` parts (a markdown part exposes its text at `.value.value`; other
 * part kinds — file trees, anchors, buttons — are skipped). */
function responseTurnText(response: readonly unknown[]): string {
  const parts: string[] = [];
  for (const part of response) {
    const value = (part as { value?: unknown }).value;
    if (value && typeof value === 'object' && typeof (value as { value?: unknown }).value === 'string') {
      parts.push((value as { value: string }).value);
    }
  }
  return parts.join('');
}

/** Summarize the native participant's chat history (VS Code turn objects). Typed
 * as `unknown[]` and narrowed at runtime so this module needs no `vscode` import
 * (the VS Code response-part union is not structurally expressible here). */
export function summarizeChatContext(history: readonly unknown[]): string {
  const lines = history
    .slice(-MAX_SUMMARY_TURNS)
    .map((turn) => {
      const t = turn as { prompt?: unknown; response?: unknown };
      if (typeof t.prompt === 'string') return `user: ${clipTurn(t.prompt, PER_TURN_CHARS)}`;
      const text = Array.isArray(t.response) ? responseTurnText(t.response) : '';
      return `assistant: ${clipTurn(text || '(no text)', PER_TURN_CHARS)}`;
    })
    .filter((line) => line.length > 'assistant: '.length);
  return capToBudget(lines, TOTAL_SUMMARY_CHARS);
}

/** Summarize a simple role/text history (the webview's representation) into the
 * same shape the native participant produces, so the backend sees identical
 * conversation context regardless of chat surface. */
export function summarizeTurns(turns: readonly { role: string; text: string }[]): string {
  const lines = turns
    .slice(-MAX_SUMMARY_TURNS)
    .filter((turn) => typeof turn.text === 'string' && turn.text.trim())
    .map((turn) => `${turn.role === 'user' ? 'user' : 'assistant'}: ${clipTurn(turn.text, PER_TURN_CHARS)}`);
  return capToBudget(lines, TOTAL_SUMMARY_CHARS);
}
