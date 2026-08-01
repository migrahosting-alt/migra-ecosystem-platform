// Explicit `/deep` (agent-mode) chat command — Copilot-style grounded answers.
//
// Unlike ordinary chat (one grounded model turn), `/deep` runs the engine's
// AGENTIC ANSWER loop: the model iteratively calls READ-ONLY workspace tools
// (search / read / find / list / git_status), gathering real evidence before
// answering with `path:line` citations. Live tool steps are rendered as progress
// so a multi-hop run feels interactive instead of a hang.
//
// Read-only by construction — no edits, no approval. `/deep cloud <q>` escalates
// to a faster/stronger cloud model. vscode-free so it is unit-testable.

import type { MigraAiClient, AnswerRequest, AnswerBudgetSpend, AnswerTimeoutEvidence, GroundedClaim, RejectedClaim } from '../services/migraAiClient.js';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';
import type { ChatSink } from './chatEngine.js';

export interface DeepCommand {
  kind: 'ask' | 'usage';
  question?: string;
  tier?: 'local' | 'cloud';
  error?: string;
}

const USAGE = [
  '**/deep — agent mode (gathers real code evidence, then answers with citations)**',
  '```',
  '/deep <question>          multi-hop grounded answer (local model)',
  '/deep cloud <question>    escalate to a faster/stronger cloud model',
  '```',
  '_Agent mode reads your workspace with read-only tools (search/read/find/list/git). It never edits._',
].join('\n');

/** Parse a `/deep` command. Returns null when the prompt is not a `/deep`
 * command (the caller falls through to normal chat). */
export function parseDeepCommand(prompt: string): DeepCommand | null {
  const m = prompt.trim().match(/^\/deep(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest) return { kind: 'usage' };
  const cloud = /^cloud\s+/i.test(rest);
  const question = cloud ? rest.replace(/^cloud\s+/i, '').trim() : rest;
  if (!question) return { kind: 'usage', error: 'Provide a question, e.g. `/deep how does auth work?`' };
  return { kind: 'ask', question, tier: cloud ? 'cloud' : 'local' };
}

/**
 * Footer describing how the answer above was verified.
 *
 * Rendered even when nothing was rejected: "0 removed, 4 evidenced" is the line
 * that makes the gate's silence meaningful. Without it, an ungated answer and a
 * fully-evidenced one look identical to the reader.
 */
export function groundingFooter(claims: GroundedClaim[], rejected: RejectedClaim[], refused: boolean): string {
  const direct = claims.filter((c) => c.kind === 'direct_evidence');
  const inferred = claims.filter((c) => c.kind === 'inference');
  const parts = [`${direct.length} evidenced`];
  if (inferred.length) parts.push(`${inferred.length} inferred`);
  parts.push(`${rejected.length} removed`);
  const sources = new Set(direct.flatMap((c) => c.sources.map((s) => `${s.path}:${s.startLine}-${s.endLine}`)));
  const cited = sources.size ? ` · sources: ${[...sources].slice(0, 6).map((s) => `\`${s}\``).join(', ')}` : '';
  const verdict = refused ? '⛔ not answered from evidence' : '✅ grounded';
  return `\n\n---\n_${verdict} — ${parts.join(', ')}${cited}_`;
}

/** Operator-readable account of a budget exhaustion. */
export function timeoutFooter(e: AnswerTimeoutEvidence): string {
  if (e.category === 'client_abort') return '';
  const which =
    e.category === 'model_call_timeout'
      ? `model call #${e.callIndex} used its full ${Math.round(e.callBudgetMs / 1000)}s budget`
      : `the run hit its overall deadline after ${Math.round(e.runElapsedMs / 1000)}s`;
  return `\n\n⏱️ _Stopped early: ${which} (${e.modelCallsCompleted} call(s) completed, ${e.contextFileCount} file(s) in context, phase \`${e.lastObservedPhase}\`)._`;
}

/**
 * What the run cost, in the units it is budgeted in.
 *
 * Shown always, including when nothing bound: an operator who cannot see that a run
 * used 1 of 2 model calls and 3 of 8 files cannot tell a well-scoped answer from
 * one that silently hit a ceiling and stopped looking.
 */
export function budgetFooter(stopReason: string, spend: AnswerBudgetSpend): string {
  const parts = [
    `${spend.modelCalls} model call${spend.modelCalls === 1 ? '' : 's'}`,
    `${spend.filesOpened} file${spend.filesOpened === 1 ? '' : 's'} opened`,
    `${spend.evidenceUnits} evidence units`,
  ];
  if (spend.expansionRounds) parts.push(`${spend.expansionRounds} expansion${spend.expansionRounds === 1 ? '' : 's'}`);
  const bound = spend.binding.length ? ` · bound by ${spend.binding.join(', ')}` : '';
  return `\n_scope: ${parts.join(', ')} · stopped: ${stopReason}${bound}_`;
}

/** Human icon for a tool step. */
function stepIcon(tool: string): string {
  switch (tool) {
    case 'search': return '🔍';
    case 'read': return '📖';
    case 'find': return '📁';
    case 'list': return '🗂️';
    case 'git_status': return '🔧';
    case 'evidence(cached)': return '♻️';
    default: return '•';
  }
}

/** Run a `/deep` agent-mode turn, rendering live tool steps and streaming the
 * answer. Errors surface as a correlated message — never a silent fallback. */
export async function runDeepCommand(
  client: MigraAiClient,
  cmd: DeepCommand,
  workspaceRoot: string | undefined,
  sink: ChatSink,
  signal: AbortSignal,
): Promise<void> {
  if (cmd.kind === 'usage') {
    sink.markdown((cmd.error ? `⚠️ ${cmd.error}\n\n` : '') + USAGE);
    return;
  }
  if (!workspaceRoot) {
    sink.markdown('⚠️ Open a folder in VS Code (File → Open Folder) — agent mode needs a workspace to inspect.');
    return;
  }

  const req: AnswerRequest = { prompt: cmd.question!, workspaceRoot, ...(cmd.tier ? { tier: cmd.tier } : {}) };
  const stepLines: string[] = [];
  let answering = false;
  let planFooter = '';
  // The Brain verifies the answer before emitting it, so the grounding verdict
  // arrives AFTER the text. Footers are rendered when they arrive, in order.
  try {
    sink.progress('🧠 Agent mode: gathering evidence…');
    for await (const ev of client.answerStream(req, signal)) {
      if (ev.type === 'route') {
        sink.progress(`🧠 Agent mode → ${ev.model} (${ev.runner})`);
      } else if (ev.type === 'phase') {
        if (ev.phase === 'answer_verification') sink.progress('🔎 Verifying every claim against retrieved evidence…');
      } else if (ev.type === 'step') {
        const q = ev.step.args.query ?? ev.step.args.path ?? '';
        stepLines.push(`${stepIcon(ev.step.tool)} \`${ev.step.tool}\`${q ? ` ${String(q)}` : ''} — ${ev.step.summary}`);
        sink.progress(`${stepIcon(ev.step.tool)} ${ev.step.summary}`);
      } else if (ev.type === 'token') {
        if (!answering) {
          // Render the collected tool trace once, then the verified answer below it.
          if (stepLines.length) sink.markdown(`**Investigation**\n${stepLines.map((l) => `- ${l}`).join('\n')}\n\n**Answer**\n`);
          answering = true;
        }
        sink.markdown(ev.text);
      } else if (ev.type === 'map') {
        if (ev.map.unavailable) sink.progress('🗺️ No git map here — exploring instead');
        else sink.progress(`🗺️ ${ev.map.paths} tracked paths ${ev.map.fromCache ? '(cached)' : `in ${ev.map.builtInMs}ms`}`);
      } else if (ev.type === 'plan') {
        planFooter = budgetFooter(ev.stopReason, ev.spend);
      } else if (ev.type === 'grounding') {
        sink.markdown(groundingFooter(ev.claims, ev.rejected, ev.refused) + planFooter);
      } else if (ev.type === 'timeout') {
        sink.markdown(timeoutFooter(ev.evidence));
      }
      // 'request', 'timings' and 'done' need no rendering.
    }
  } catch (err) {
    if (isPilotError(err) && err.code === 'CANCELLED') return;
    const code = isPilotError(err) ? err.code : 'NETWORK';
    sink.markdown(`\n\n⚠️ ${toUserMessage(code)}`);
  }
}
