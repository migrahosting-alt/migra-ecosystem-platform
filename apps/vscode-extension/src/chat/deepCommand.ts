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

import type { MigraAiClient, AnswerRequest } from '../services/migraAiClient.js';
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

/** Human icon for a tool step. */
function stepIcon(tool: string): string {
  switch (tool) {
    case 'search': return '🔍';
    case 'read': return '📖';
    case 'find': return '📁';
    case 'list': return '🗂️';
    case 'git_status': return '🔧';
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
  try {
    sink.progress('🧠 Agent mode: gathering evidence…');
    for await (const ev of client.answerStream(req, signal)) {
      if (ev.type === 'route') {
        sink.progress(`🧠 Agent mode → ${ev.model}`);
      } else if (ev.type === 'step') {
        const q = ev.step.args.query ?? ev.step.args.path ?? '';
        stepLines.push(`${stepIcon(ev.step.tool)} \`${ev.step.tool}\`${q ? ` ${String(q)}` : ''} — ${ev.step.summary}`);
        sink.progress(`${stepIcon(ev.step.tool)} ${ev.step.summary}`);
      } else if (ev.type === 'token') {
        if (!answering) {
          // Render the collected tool trace once, then stream the answer below it.
          if (stepLines.length) sink.markdown(`**Investigation**\n${stepLines.map((l) => `- ${l}`).join('\n')}\n\n**Answer**\n`);
          answering = true;
        }
        sink.markdown(ev.text);
      }
      // 'done' needs no rendering.
    }
  } catch (err) {
    if (isPilotError(err) && err.code === 'CANCELLED') return;
    const code = isPilotError(err) ? err.code : 'NETWORK';
    sink.markdown(`\n\n⚠️ ${toUserMessage(code)}`);
  }
}
