// Render a local workspace-engineer run into the chat sink (Slice 2).
//
// The conversational model is NEVER involved: every line rendered here is
// machine-authored from engine events. Failures surface as machine blocks —
// the same honesty contract as /agent.

import type { MigraAiClient, EngineerRequest } from '../services/migraAiClient.js';
import type { EngineeringTask } from '@migrapilot/shared-types';
import { liveKnowledgeBadge, sourceModeBadge } from '../panel/shell/composerModel.js';
import { recordCorrelation } from '../interaction/correlationLog.js';
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
  /** Brain-owned task envelope. The host stores only the pointer/recovery UI. */
  onTask?(task: EngineeringTask): void;
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

/** Human-readable step line. The Brain's `summary` is the tool's raw input
 * object, which must never reach the chat surface as protocol text. */
function renderStep(step: StepData): string {
  const tool = step.tool ?? 'tool';
  const raw = (step.summary ?? '').trim();
  let args: Record<string, unknown> = {};
  if (raw.startsWith('{')) {
    try {
      args = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      args = {};
    }
  } else if (raw) {
    return `\n· \`${tool}\` ${raw}\n`;
  }
  const str = (key: string): string | undefined => (typeof args[key] === 'string' ? (args[key] as string) : undefined);
  const detail =
    str('query') ? `“${str('query')}”` :
    str('path') ? `\`${str('path')}\`` :
    str('symbol') ? `\`${str('symbol')}\`` :
    '';
  const verb: Record<string, string> = {
    'workspace.search': 'Searching for',
    'workspace.find': 'Looking for',
    'workspace.list': 'Listing files',
    'file.read': 'Reading',
    'file.readRange': 'Reading',
    'file.readSymbol': 'Reading symbol',
    'git.status': 'Checking git status',
    'git.diff': 'Reading the diff',
    'diagnostics.get': 'Checking problems',
    'fs.proposeChangeset': 'Preparing a changeset',
    'edit.preview': 'Preparing an edit',
  };
  const label = verb[tool] ?? `Running ${tool}`;
  return `\n· ${label}${detail ? ` ${detail}` : ''}\n`;
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
  /*
   * The answer is rendered ONCE, but the stream is read to its end.
   *
   * Both the `final` and `error` branches used to `return` here, and the server
   * always sends `final` BEFORE `done` — so `done` was never read and
   * `onAttribution` never fired on a successful run. Which model answered, under
   * which policy, and whether a fallback was recommended was computed, streamed,
   * and dropped on the floor every single time. It also made the client log
   * "engineer stream ended without a done frame" on healthy runs, because closing
   * the generator early is indistinguishable from a truncated stream.
   */
  let answerRendered = false;
  /*
   * 🚨 PROVENANCE IS ONE LINE, NOT A WALL.
   *
   * OBSERVED: a user typed "hi" and read SIX stacked italic lines — source mode,
   * live knowledge, sources accepted, capability, tier, and an unverified task
   * class — above a one-line greeting. Every line was true. None was informative
   * for that turn, and together they made the product look unsure of itself.
   *
   * The fix is density, not deletion. Nothing is dropped: the same facts are
   * joined into a single muted line, so a reader who wants them has them and a
   * reader who does not is not made to scroll past them. Deleting them was the
   * tempting fix and the wrong one — a turn that answers from the working tree
   * when approved evidence was requested MUST still say so, and there is no
   * reliable way at this point in the stream to know which turn that is.
   *
   * Buffered because the three frames arrive separately. That costs nothing: the
   * Brain sends all of them BEFORE generation begins, and the buffer is flushed
   * the moment any answer text appears, so provenance still precedes the answer.
   */
  const provenance: string[] = [];
  let provenanceFlushed = false;
  const flushProvenance = (): void => {
    if (provenanceFlushed) return;
    provenanceFlushed = true;
    if (provenance.length) sink.markdown(`_${provenance.join(' · ')}_\n\n`);
  };
  try {
    for await (const ev of client.engineerStream(req, signal)) {
      if (ev.event === 'grounding') {
        // HOST-RENDERED provenance. The model does not decide whether this shows:
        // "say that you used the working tree" is an instruction, not a guarantee.
        const badge = sourceModeBadge(ev.data as Parameters<typeof sourceModeBadge>[0]);
        if (badge) provenance.push(badge);
      } else if (ev.event === 'liveKnowledge') {
        // The SECOND frame. Still a SEPARATE statement from the repository one —
        // "no repository evidence" and "no external evidence" describe different
        // boundaries and must stay distinguishable. Sharing a line does not merge
        // them; each keeps its own wording, separated by a divider.
        provenance.push(...liveKnowledgeBadge(ev.data as Parameters<typeof liveKnowledgeBadge>[0]));
      } else if (ev.event === 'capability') {
        // The THIRD host-owned frame: which model acted, with what standing, and what went
        // unverified. Separate from the other two because it answers a different question —
        // those describe the EVIDENCE a turn used, this describes the AUTHORITY it had.
        provenance.push(...((ev.data as { disclosure?: string[] }).disclosure ?? []));
      } else if (ev.event === 'refusal') {
        flushProvenance();
        // Refusals now come from TWO boundaries and must not wear each other's wording. A
        // capability denial rendered as "insufficient approved evidence" would send an
        // operator to re-approve an index that was never the problem.
        const d = ev.data as { code?: string; message?: string; reason?: string };
        /*
         * SWITCH ON THE CODE, and default to saying only what is known.
         *
         * This was an if/else whose else-branch called EVERY non-capability refusal
         * "Insufficient approved evidence" — so a GPU_BUSY refusal, which is about
         * the graphics card being committed elsewhere, would have sent the operator
         * off to re-approve a semantic index that was never involved. The file's own
         * comment warns that refusals from different boundaries must not wear each
         * other's wording; an open-ended else could not honour that.
         */
        if (d.code === 'CAPABILITY_DENIED') {
          sink.markdown(
            `\n**Capability authority denied.**\n\n${d.message ?? 'This model has no measured standing for this class of work.'}\n\n_No model was called for this request._\n`,
          );
        } else if (d.code === 'GPU_BUSY') {
          /*
           * The HEADING must not out-claim the sentence beneath it.
           *
           * It used to read "The graphics card is busy", which asserts a competing
           * workload. The Brain only has evidence for that when it actually saw a
           * render; otherwise all it knows is that the card did not answer in time —
           * and it now sends a sentence that says exactly that. A confident heading
           * above a careful sentence is still a confident claim, so the heading
           * states the outcome and the Brain's own wording supplies the cause.
           */
          sink.markdown(
            `\n**Your request has not started.**\n\n${d.message ?? 'The graphics card did not respond in time.'}\n\n_Nothing was sent to a model, and nothing in your workspace changed._\n`,
          );
        } else if (d.code === 'ENGINE_UNAVAILABLE') {
          sink.markdown(
            `\n**The AI engine is not reachable.**\n\n${d.message ?? 'The engine could not be reached, so this request has not started.'}\n\n_Nothing was sent to a model, and nothing in your workspace changed._\n`,
          );
        } else if (d.code === 'INSUFFICIENT_APPROVED_EVIDENCE' || d.code === undefined) {
          // An approved-only turn the Brain could not ground. Rendered verbatim from
          // the Brain's reason — the loop never started, so there is nothing else.
          sink.markdown(`\n**Insufficient approved evidence.**\n\n${d.message ?? 'The approved semantic index does not support this request.'}\n\n_No working-tree files were consulted._\n`);
        } else {
          // A refusal code this client does not know yet. Say that, rather than
          // guessing at a cause and sending someone to fix the wrong thing.
          sink.markdown(`\n**Request refused: ${d.code}.**\n\n${d.message ?? d.reason ?? 'The Brain refused this request before starting.'}\n\n_The loop never started._\n`);
        }
      } else if (ev.event === 'route') {
        const d = ev.data as { model?: string; correlationId?: string; taskClass?: string; workflow?: string };
        // Keep the correlation id. The Brain audits under it, and without this the record
        // for a turn the editor caused is unreachable from the editor that caused it.
        if (d.correlationId) {
          recordCorrelation({
            correlationId: d.correlationId,
            at: Date.now(),
            ...(d.model ? { model: d.model } : {}),
            ...(req.taskClass ? { taskClass: req.taskClass } : {}),
            ...(req.workflow ? { workflow: req.workflow } : {}),
          });
        }
        sink.progress?.(`MigraPilot → ${d.model ?? 'model'}`);
      } else if (ev.event === 'step') {
        const d = ev.data as StepData;
        sink.markdown(renderStep(d));
      } else if (ev.event === 'note') {
        streamed = ''; // a note breaks the run of streamed text
        // Visible reporting of normalization/dedup/command-effects/re-plans.
        const d = ev.data as NoteData;
        // A plan is multi-line and is the agent's stated intent — render it as a
        // block rather than squeezing it onto an italic one-liner.
        if (d.kind === 'plan') {
          streamed = '';
          sink.markdown(`\n\n\`\`\`text\n${d.message ?? ''}\n\`\`\`\n`);
          continue;
        }
        const icon = d.kind === 'command-effect' ? '📝' : d.kind === 'duplicate' ? '↩︎' : d.kind === 'policy' ? '⛔' : d.kind === 'replan' ? '↻' : d.kind === 'quality' ? '⚠️' : 'ℹ︎';
        sink.markdown(`\n  ${icon} _${d.message ?? d.kind ?? 'note'}_\n`);
      } else if (ev.event === 'proposal') {
        // Keep the normal chat surface structured. A native task card owns the
        // proposal presentation; markdown is only the compatibility fallback
        // for surfaces that do not implement the task-card callback.
        const task = (ev.data as { task?: EngineeringTask }).task;
        if (task) sink.onTask?.(task);
        else sink.markdown(`\n${renderProposal(ev.data as ProposalData)}\n`);
        sink.onProposal?.(ev.data);
      } else if (ev.event === 'task') {
        const task = (ev.data as { task?: EngineeringTask }).task;
        if (task) sink.onTask?.(task);
      } else if (ev.event === 'escalation_offer') {
        // A defined local failure produced a cloud escalation OFFER. Consent is
        // handled by the caller (a modal) — no cloud call happens without it.
        await sink.onEscalation?.(ev.data);
      } else if (ev.event === 'done') {
        sink.onAttribution?.((ev.data as { routing?: unknown }).routing);
      } else if (ev.event === 'token') {
        flushProvenance();
        const text = (ev.data as TokenData).text ?? '';
        if (text) {
          streamed += text;
          sink.markdown(text);
        }
      } else if (ev.event === 'final') {
        flushProvenance();
        if (answerRendered) continue; // exactly one answer, however many frames arrive
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
        answerRendered = true;
      } else if (ev.event === 'error') {
        flushProvenance();
        if (answerRendered) continue;
        answerRendered = true;
        const d = ev.data as ErrorData;
        sink.markdown([
          '\n**Engineer run failed.**',
          '```',
          `Failure: ${d.code ?? 'UNKNOWN'} — ${d.message ?? 'no detail'}`,
          'No further tools executed.',
          '```',
        ].join('\n'));
        // Deliberately NOT returning: a failed run still reports which model and
        // policy produced the failure, and that is exactly when it is worth knowing.
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
