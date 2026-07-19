// Render a MODEL-FREE read-only workspace inspection into the chat (fix for the
// local-tool routing refusal). Every line here is machine-authored from real
// local-runner results — the conversational model is NEVER involved, so it can
// never falsely claim it "cannot access your local environment".
//
// Errors are TRUTHFUL and TYPED (workspace_not_open, local_runner_unavailable,
// scope_not_authorized, policy_denied, tool_not_available, tool_execution_failed,
// tool_execution_timed_out) with a trace id, the selected runner, the requested
// operation, the policy decision, and a safe remediation.

import { isPilotError } from '@migrapilot/pilot-client';
import type { MigraAiClient, InspectResponse, InspectErrorCode } from '../services/migraAiClient.js';
import type { InspectionStep } from './intentRouter.js';

export interface InspectionSink {
  markdown(text: string): void;
  progress?(text: string): void;
}

/** Every code the inspection surface can report (brain-typed + the two the
 * extension detects locally). */
export type RoutingErrorCode = InspectErrorCode | 'local_runner_unavailable';

const REMEDIATION: Record<RoutingErrorCode, string> = {
  workspace_not_open: 'Open a folder in VS Code (File → Open Folder), then retry.',
  local_runner_unavailable: 'Start the MigraPilot local brain (the local runner) and retry — it was unreachable.',
  scope_not_authorized: 'Use a path inside the open workspace; inspection is confined to the authorized root.',
  tool_not_available: 'The local runner does not expose this read-only operation.',
  policy_denied: 'The active policy denies this operation. Adjust the MigraPilot policy to allow read-only inspection.',
  tool_execution_failed: 'The read-only command failed; nothing was modified. See the message.',
  tool_execution_timed_out: 'The read-only command exceeded its time budget and was aborted; nothing was modified.',
};

/** Truthful, typed error block — NEVER a generic "AI can't access local" line. */
export function renderRoutingError(
  sink: InspectionSink,
  code: RoutingErrorCode,
  ctx: { operation: string; traceId: string; message?: string; remediation?: string },
): void {
  sink.markdown(
    [
      '\n**Local inspection could not complete.**',
      '```',
      `error:       ${code}`,
      `operation:   ${ctx.operation}`,
      `runner:      local`,
      `policy:      read-only inspection (no mutation approval required)`,
      `trace:       ${ctx.traceId}`,
      ...(ctx.message ? [`detail:      ${ctx.message}`] : []),
      `remediation: ${ctx.remediation ?? REMEDIATION[code]}`,
      '```',
    ].join('\n'),
  );
}

function renderOk(sink: InspectionSink, res: Extract<InspectResponse, { ok: true }>): void {
  const d = res.data as Record<string, unknown>;
  switch (res.op) {
    case 'workspace_root':
      sink.markdown(`\n**Workspace root:** \`${String(d.root)}\`\n`);
      break;
    case 'git_status': {
      const files = (d.files as Array<{ status: string; path: string }>) ?? [];
      const head = `\n**git status** — branch \`${d.branch ?? '(detached)'}\`, ${d.clean ? 'clean' : `${files.length} change(s)`}:`;
      const body = d.clean ? '\n_(working tree clean)_\n' : '\n```\n' + files.slice(0, 100).map((f) => `${f.status} ${f.path}`).join('\n') + '\n```\n';
      sink.markdown(head + body);
      break;
    }
    case 'git_branch':
      sink.markdown(`\n**git branch:** \`${d.branch ?? '(detached HEAD)'}\`\n`);
      break;
    case 'git_head':
      sink.markdown(`\n**git HEAD:** \`${d.head ?? '(no commits)'}\`\n`);
      break;
    case 'git_remotes': {
      const remotes = (d.remotes as Array<{ name: string; url: string }>) ?? [];
      sink.markdown('\n**git remotes:**\n' + (remotes.length ? '```\n' + remotes.map((r) => `${r.name}\t${r.url}`).join('\n') + '\n```\n' : '_(none configured)_\n'));
      break;
    }
    case 'pkg_manager':
      sink.markdown(`\n**Package manager:** \`${d.manager}\` _(${d.evidence})_\n`);
      break;
    case 'list': {
      const entries = (d.entries as Array<{ name: string; type: string }>) ?? [];
      sink.markdown(`\n**Directory \`${d.dir}\`** (${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}):\n` + '```\n' + entries.map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}`).join('\n') + '\n```\n');
      break;
    }
    case 'find': {
      const matches = (d.matches as Array<{ path: string; type: string }>) ?? [];
      const scope = d.kind === 'dir' ? 'director' : d.kind === 'file' ? 'file' : 'name';
      sink.markdown(`\n**Find \`${d.query}\`** (${scope} match) — ${matches.length} result(s):\n` + (matches.length ? '```\n' + matches.slice(0, 100).map((m) => `${m.type === 'dir' ? '📁' : '📄'} ${m.path}`).join('\n') + '\n```\n' : '_(no matches)_\n'));
      break;
    }
    case 'search': {
      const matches = (d.matches as Array<{ path: string; line: number; preview: string }>) ?? [];
      sink.markdown(`\n**Content search \`${d.query}\`** — ${matches.length} match(es):\n` + (matches.length ? '```\n' + matches.slice(0, 50).map((m) => `${m.path}:${m.line}: ${m.preview.trim().slice(0, 120)}`).join('\n') + '\n```\n' : '_(no matches)_\n'));
      break;
    }
    case 'read':
      sink.markdown(`\n**${String(d.tool ?? 'file')}** \`${String((d as { path?: string }).path ?? '')}\`:\n` + '```\n' + String(d.content ?? '') + '\n```\n');
      break;
    default:
      sink.markdown('\n```json\n' + JSON.stringify(d).slice(0, 2000) + '\n```\n');
  }
}

/**
 * Run a read-only inspection plan on the LOCAL runner and render real results.
 * `rootPath` must be the active/authorized workspace root. Returns when the plan
 * is complete or a fatal (runner-unavailable) error is rendered.
 */
export async function runInspectionTurn(
  client: MigraAiClient,
  rootPath: string,
  steps: InspectionStep[],
  sink: InspectionSink,
  signal?: AbortSignal,
): Promise<void> {
  sink.progress?.('Inspecting the workspace on the local runner…');
  sink.markdown('\n_Read-only workspace inspection · runner: local_\n');
  for (const step of steps) {
    if (signal?.aborted) return;
    let res: InspectResponse;
    try {
      res = await client.inspect({ rootPath, op: step.op, ...(step.path ? { path: step.path } : {}), ...(step.query ? { query: step.query } : {}), ...(step.kind ? { kind: step.kind } : {}) }, signal);
    } catch (err) {
      // Transport failure = the local runner is unreachable. Truthful + typed.
      const traceId = isPilotError(err) ? err.requestId ?? 'n/a' : 'n/a';
      const message = err instanceof Error ? err.message : String(err);
      renderRoutingError(sink, 'local_runner_unavailable', { operation: step.op, traceId, message });
      return; // no point continuing the plan if the runner is down
    }
    if (res.ok) {
      renderOk(sink, res);
    } else {
      renderRoutingError(sink, res.code, { operation: res.op ?? step.op, traceId: res.traceId, message: res.error, remediation: res.remediation });
    }
  }
}
