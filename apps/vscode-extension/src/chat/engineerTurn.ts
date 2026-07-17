// Render a local workspace-engineer run into the chat sink (Slice 2).
//
// The conversational model is NEVER involved: every line rendered here is
// machine-authored from engine events. Failures surface as machine blocks —
// the same honesty contract as /agent.

import type { MigraAiClient, EngineerRequest } from '../services/migraAiClient.js';
import { isPilotError } from '@migrapilot/pilot-client';

export interface EngineerSink {
  markdown(text: string): void;
  progress?(text: string): void;
}

interface StepData { n?: number; tool?: string; summary?: string }
interface NoteData { n?: number; kind?: string; message?: string }
interface ProposalData { n?: number; preview?: { files?: Array<{ path?: string; before?: string; after?: string }> } }
interface FinalData { markdown?: string; steps?: number }
interface ErrorData { code?: string; message?: string }

function renderProposal(data: ProposalData): string {
  const files = data.preview?.files ?? [];
  const blocks = files.map((f) => [
    `**Proposed change — \`${f.path ?? 'unknown'}\`** (not applied; approval required to apply):`,
    '```diff',
    ...String(f.before ?? '').split('\n').map((l) => `- ${l}`),
    ...String(f.after ?? '').split('\n').map((l) => `+ ${l}`),
    '```',
  ].join('\n'));
  return blocks.join('\n\n') || '_Proposal recorded (no file preview supplied)._';
}

/**
 * Drive one engineer run and render it. Returns when the run reaches a
 * terminal event (final/error) or the stream ends.
 */
export async function runEngineerTurn(
  client: MigraAiClient,
  req: EngineerRequest,
  sink: EngineerSink,
  signal?: AbortSignal,
): Promise<void> {
  sink.progress?.('Engineer is working on your task…');
  try {
    for await (const ev of client.engineerStream(req, signal)) {
      if (ev.event === 'route') {
        const d = ev.data as { model?: string };
        sink.progress?.(`Engineer → ${d.model ?? 'model'}`);
      } else if (ev.event === 'step') {
        const d = ev.data as StepData;
        sink.markdown(`\n· \`${d.tool ?? 'tool'}\` ${d.summary ?? ''}\n`);
      } else if (ev.event === 'note') {
        // Visible reporting of normalization/dedup/command-effects/re-plans.
        const d = ev.data as NoteData;
        const icon = d.kind === 'command-effect' ? '📝' : d.kind === 'duplicate' ? '↩︎' : d.kind === 'policy' ? '⛔' : d.kind === 'replan' ? '↻' : 'ℹ︎';
        sink.markdown(`\n  ${icon} _${d.message ?? d.kind ?? 'note'}_\n`);
      } else if (ev.event === 'proposal') {
        sink.markdown(`\n${renderProposal(ev.data as ProposalData)}\n`);
      } else if (ev.event === 'final') {
        const d = ev.data as FinalData;
        sink.markdown(`\n${d.markdown ?? ''}\n`);
        return;
      } else if (ev.event === 'error') {
        const d = ev.data as ErrorData;
        sink.markdown([
          '\n**Engineer run failed.**',
          '```',
          `Failure: ${d.code ?? 'UNKNOWN'} — ${d.message ?? 'no detail'}`,
          'No further tools executed.',
          '```',
        ].join('\n'));
        return;
      }
    }
  } catch (err) {
    const code = isPilotError(err) ? err.code : 'NETWORK';
    const detail = isPilotError(err) && err.message ? ` — ${err.message}` : '';
    const requestId = isPilotError(err) ? err.requestId : undefined;
    sink.markdown([
      '\n**Engineer dispatch failed before execution.**',
      '```',
      `Failure: ${code}${detail}`,
      'No tools executed.',
      ...(requestId ? [`Request: ${requestId}`] : []),
      '```',
    ].join('\n'));
  }
}
