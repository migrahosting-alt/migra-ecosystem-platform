// Explicit `/agent` chat command — the ONLY chat path to the agent runtime.
//
// Design rules (why this file exists):
//  - Chat text NEVER reaches the agent runtime implicitly. A delegated/tool run is
//    dispatched only by this EXPLICIT command — no NL intent inference, so a chat
//    model can never be asked to "pretend" to run a tool.
//  - The conversational model is NEVER in the loop for an /agent turn. Success
//    renders the engine's structured run view (JSON); failure renders a
//    MACHINE-GENERATED execution error (runtime, state, failure code, run id) —
//    never an LLM apology, never a silent fallback to chat.
//  - vscode-free so the parse + dispatch + rendering are unit-testable and can be
//    driven against a live engine without an editor.
//
// Syntax:
//   /agent <agentId> [json-input]     create + start a run (input defaults from
//                                     the active workspace/file when omitted)
//   /agent status <runId>             reconcile a run's authoritative state
//   /agent approve <runId>            approve a parked run (by runId — no tokens)
//   /agent reject <runId>             reject a parked run

import type { MigraAiClient, AgentRunView } from '../services/migraAiClient.js';
import { isPilotError } from '@migrapilot/pilot-client';

export type AgentCommand =
  | { kind: 'run'; agentId: string; input?: unknown }
  | { kind: 'status' | 'approve' | 'reject'; runId: string }
  | { kind: 'usage'; error?: string };

const USAGE = [
  '**/agent — run an engine agent (no model in the loop)**',
  '```',
  '/agent <agentId> [json-input]   run an agent (e.g. /agent workspace.diagnostics.pilot)',
  '/agent status  <runId>          authoritative run state',
  '/agent approve <runId>          approve a parked run',
  '/agent reject  <runId>          reject a parked run',
  '```',
].join('\n');

/** Parse an explicit /agent command. Returns null when the prompt is NOT an
 * /agent command (the caller falls through to normal chat). */
export function parseAgentCommand(prompt: string): AgentCommand | null {
  const m = prompt.trim().match(/^\/agent(?:\s+(.*))?$/s);
  if (!m) return null;
  const rest = (m[1] ?? '').trim();
  if (!rest) return { kind: 'usage' };

  const [head, ...tail] = rest.split(/\s+/);
  if (head === 'status' || head === 'approve' || head === 'reject') {
    const runId = tail[0];
    if (!runId) return { kind: 'usage', error: `\`/agent ${head}\` requires a runId.` };
    return { kind: head, runId };
  }

  const jsonStart = rest.indexOf('{');
  const agentId = (jsonStart === -1 ? rest : rest.slice(0, jsonStart)).trim();
  if (!agentId) return { kind: 'usage', error: 'An agentId is required.' };
  if (jsonStart === -1) return { kind: 'run', agentId };
  try {
    return { kind: 'run', agentId, input: JSON.parse(rest.slice(jsonStart)) };
  } catch {
    return { kind: 'usage', error: 'The input after the agent id must be valid JSON.' };
  }
}

/** Minimal sink contract (mirrors ChatSink without importing vscode). */
export interface AgentCommandSink {
  markdown(text: string): void;
  progress?(text: string): void;
}

export interface AgentCommandDefaults {
  rootPath?: string;
  path?: string;
}

/** Render the authoritative run view — structured, machine-shaped, model-free. */
export function renderRunView(view: AgentRunView): string {
  if (view.state === 'FAILED') {
    const code = view.error?.code ?? 'UNKNOWN';
    const message = view.error?.message ?? 'No failure detail from the engine.';
    return [
      '**Runtime execution failed.**',
      '```',
      `Runtime: ${view.runtime}`,
      `State:   ${view.state}`,
      `Failure: ${code} — ${message}`,
      'Tool not executed.',
      `Run:     ${view.runId}`,
      '```',
    ].join('\n');
  }
  if (view.state === 'WAITING_FOR_APPROVAL') {
    return [
      '**Run is parked — approval required.** No action has executed.',
      '```',
      `Runtime: ${view.runtime}`,
      `State:   ${view.state}`,
      `Action:  ${view.pendingAction?.tool ?? 'unknown'} — ${view.pendingAction?.summary ?? ''}`,
      `Run:     ${view.runId}`,
      '```',
      `Approve with \`/agent approve ${view.runId}\` or reject with \`/agent reject ${view.runId}\`.`,
    ].join('\n');
  }
  // COMPLETED / CANCELLED / other terminal + non-terminal states: structured JSON.
  const body = JSON.stringify({ runId: view.runId, runtime: view.runtime, state: view.state, result: view.result ?? null, error: view.error ?? null }, null, 2);
  return ['```json', body, '```'].join('\n');
}

/**
 * Dispatch an /agent command against the engine and render the outcome. All
 * failures — transport or run — surface as machine-generated blocks. This
 * function never invokes a chat model and never falls back to one.
 */
export async function runAgentCommand(
  client: MigraAiClient,
  cmd: AgentCommand,
  sink: AgentCommandSink,
  defaults: AgentCommandDefaults = {},
): Promise<void> {
  if (cmd.kind === 'usage') {
    sink.markdown([cmd.error, USAGE].filter(Boolean).join('\n\n'));
    return;
  }
  try {
    if (cmd.kind === 'run') {
      const input = cmd.input ?? { rootPath: defaults.rootPath, path: defaults.path };
      sink.progress?.(`Dispatching ${cmd.agentId} to the engine…`);
      const view = await client.createAgentRun({ agentId: cmd.agentId, input });
      sink.markdown(renderRunView(view));
      return;
    }
    if (cmd.kind === 'status') {
      sink.markdown(renderRunView(await client.getAgentRun(cmd.runId)));
      return;
    }
    // approve / reject — by runId only; approval material never touches the client.
    sink.markdown(renderRunView(await client.resumeAgentRun(cmd.runId, cmd.kind === 'approve' ? 'approve' : 'reject')));
  } catch (err) {
    const code = isPilotError(err) ? err.code : 'NETWORK';
    const requestId = isPilotError(err) ? err.requestId : undefined;
    // Relay the engine's sanitized failure detail (e.g. schema issues on
    // INVALID_INPUT) so the operator sees WHY — still machine-authored.
    const detail = isPilotError(err) && err.message ? ` — ${err.message}` : '';
    sink.markdown([
      '**Runtime dispatch failed before execution.**',
      '```',
      `Failure: ${code}${detail}`,
      'Tool not executed.',
      ...(requestId ? [`Request: ${requestId}`] : []),
      '```',
    ].join('\n'));
  }
}
