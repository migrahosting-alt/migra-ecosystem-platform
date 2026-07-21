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
  /** Slice 5: a server-issued cloud escalation offer needs explicit consent. */
  onEscalation?(offer: unknown): Promise<void> | void;
  /** Slice 5: provider attribution for the completed run (from the done frame). */
  onAttribution?(routing: unknown): void;
  /** A changeset/edit proposal was surfaced — the host may offer to apply it
   * (user-confirmed) after the run. Called in addition to the markdown render. */
  onProposal?(proposal: unknown): void;
}

interface StepData { n?: number; tool?: string; summary?: string }
interface NoteData { n?: number; kind?: string; message?: string }
interface PreviewFile { path?: string; before?: string; after?: string }
interface ChangesetPreviewOp { op?: string; path?: string; kind?: string; before?: string | null; after?: string | null }
interface ProposalData {
  n?: number;
  preview?: {
    files?: PreviewFile[]; // edit.preview shape
    ops?: ChangesetPreviewOp[]; // fs.proposeChangeset shape
    proposalHash?: string;
    fileCount?: number;
  };
}
interface FinalData { markdown?: string; steps?: number; streamedPrefix?: boolean }
interface TokenData { text?: string }
interface ErrorData { code?: string; message?: string }

function diffBlock(title: string, before: string | null | undefined, after: string | null | undefined): string {
  return [
    title,
    '```diff',
    ...String(before ?? '').split('\n').filter((_, i, a) => before != null || a.length > 1).map((l) => `- ${l}`),
    ...String(after ?? '').split('\n').filter((_, i, a) => after != null || a.length > 1).map((l) => `+ ${l}`),
    '```',
  ].join('\n');
}

function renderProposal(data: ProposalData): string {
  const p = data.preview;
  // fs.proposeChangeset shape — new files render as ADDITIONS, not failed edits.
  if (p?.ops?.length) {
    const header = `**Proposed changeset** (${p.fileCount ?? p.ops.length} file(s), not applied; approval required)${p.proposalHash ? ` · \`${p.proposalHash.slice(0, 12)}\`` : ''}:`;
    const blocks = p.ops.map((o) => {
      const label = o.kind === 'add' ? 'create' : o.kind === 'delete' ? 'delete' : o.kind === 'mkdir' ? 'mkdir' : 'modify';
      if (o.kind === 'mkdir') return `- \`${o.path}\` — **${label}** (directory)`;
      return diffBlock(`- \`${o.path}\` — **${label}**:`, o.before, o.after);
    });
    return [header, ...blocks].join('\n\n');
  }
  // edit.preview shape (line-range edits to existing files).
  const files = p?.files ?? [];
  const blocks = files.map((f) =>
    diffBlock(`**Proposed change — \`${f.path ?? 'unknown'}\`** (not applied; approval required to apply):`, f.before, f.after),
  );
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
  // Role-neutral: this one path now serves questions as well as build work.
  sink.progress?.('MigraPilot is working…');
  // Text already rendered from `token` events. The agent streams its answer as
  // it is written, so the `final` event usually repeats what the user can
  // already see — we append only the remainder.
  let streamed = '';
  try {
    for await (const ev of client.engineerStream(req, signal)) {
      if (ev.event === 'route') {
        const d = ev.data as { model?: string };
        sink.progress?.(`MigraPilot → ${d.model ?? 'model'}`);
      } else if (ev.event === 'step') {
        const d = ev.data as StepData;
        sink.markdown(`\n· \`${d.tool ?? 'tool'}\` ${d.summary ?? ''}\n`);
      } else if (ev.event === 'note') {
        streamed = ''; // a note breaks the run of streamed text
        // Visible reporting of normalization/dedup/command-effects/re-plans.
        const d = ev.data as NoteData;
        const icon = d.kind === 'command-effect' ? '📝' : d.kind === 'duplicate' ? '↩︎' : d.kind === 'policy' ? '⛔' : d.kind === 'replan' ? '↻' : d.kind === 'quality' ? '⚠️' : 'ℹ︎';
        sink.markdown(`\n  ${icon} _${d.message ?? d.kind ?? 'note'}_\n`);
      } else if (ev.event === 'proposal') {
        sink.markdown(`\n${renderProposal(ev.data as ProposalData)}\n`);
        sink.onProposal?.(ev.data);
      } else if (ev.event === 'escalation_offer') {
        // A defined local failure produced a cloud escalation OFFER. Consent is
        // handled by the caller (a modal) — no cloud call happens without it.
        await sink.onEscalation?.(ev.data);
      } else if (ev.event === 'done') {
        sink.onAttribution?.((ev.data as { routing?: unknown }).routing);
      } else if (ev.event === 'token') {
        const text = (ev.data as TokenData).text ?? '';
        if (text) {
          streamed += text;
          sink.markdown(text);
        }
      } else if (ev.event === 'final') {
        const d = ev.data as FinalData;
        const markdown = d.markdown ?? '';
        if (d.streamedPrefix && streamed && markdown.startsWith(streamed)) {
          // Append only what has not been shown (footers, machine-authored
          // truth notes) instead of repeating the whole answer.
          const rest = markdown.slice(streamed.length);
          if (rest) sink.markdown(rest);
        } else {
          // Not a continuation — a correction replaced the streamed text, so
          // separate the two rather than running them together.
          sink.markdown(`${streamed ? '\n\n---\n' : '\n'}${markdown}\n`);
        }
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
