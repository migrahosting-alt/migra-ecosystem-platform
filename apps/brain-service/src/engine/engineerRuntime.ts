// Engineer runtime — the model-in-the-loop workspace agent behind
// POST /api/ai/engineer (Slice 2: workspace-agent capability routing; Slice 3A:
// loop hardening).
//
// A SEPARATE surface from the agent registry: registry agents have
// DETERMINISTIC fixed plans (replayable, delegable to pilot-api); this loop is
// model-driven and local-only. It never touches the pilot runtime, so disabled
// remote delegation cannot affect ordinary local work.
//
// Protocol: the model replies with ONE JSON object per step —
//   {"action": {"tool": "<id>", "input": {...}}}   execute a tool and continue
//   {"final": "<markdown answer>"}                 finish the task
//
// Slice 3A hardening (deterministic, policy-preserving):
//  - duplicate suppression: identical/equivalent calls return the recorded
//    result instead of re-executing, and the model is told it already ran;
//  - input normalization + bounded repair: absolute-under-root paths become
//    relative, out-of-root paths are refused, line coords are normalized to the
//    1-based contract — only deterministic fixes, never invented arguments;
//  - no-progress detection: steps that add nothing force a re-plan, then
//    terminate with an explicit LOOP_NO_PROGRESS failure;
//  - final-response enforcement: weak/deferral finals get one corrective retry;
//  - command-write policy: workspace-local side effects are permitted and
//    reported; publish/deploy/release/push-style commands are refused.
//
// Mutation policy (owner, 2026-07-16): the loop NEVER writes via edit.apply —
// it is substituted with edit.preview and surfaced as a PROPOSAL. command.run
// side effects (npm install, etc.) are permitted, contained, and reported.

import { NOOP_STAGE_LOGGER, type StageLogger } from './correlation.js';

export interface EngineerToolInfo {
  id: string;
  description: string;
  readOnly: boolean;
  /** One-line input shape hint shown to the model. */
  inputHint: string;
}

export interface EngineerDeps {
  /** One buffered completion (prompt → text) on an engine-selected coding model. */
  complete(prompt: string): Promise<string>;
  /** Execute a tool through the capability registry (validated + audited). */
  executeTool(tool: string, input: unknown): Promise<unknown>;
  /** The tool catalog the loop may use (already filtered by the caller). */
  tools: EngineerToolInfo[];
  /** Optional workspace file lister — enables command side-effect reporting and
   * the "new files" progress signal. Absent in pure unit contexts. */
  listFiles?(rootPath: string): Promise<string[]>;
  /** Correlation logger — emits a structured line per loop stage. Defaults to
   * no-op so pure unit contexts need not supply one. */
  stage?: StageLogger;
  maxSteps?: number;
  /** Cap for tool results fed back to the model (chars). */
  resultCap?: number;
  /** Consecutive no-progress steps before forcing a re-plan / terminating. */
  noProgressLimit?: number;
  /** How many times the loop may force a re-plan before LOOP_NO_PROGRESS. */
  maxReplans?: number;
}

export interface EngineerInput {
  rootPath: string;
  task: string;
  /** Attach the MigraTeck ecosystem context block (detected by the caller). */
  ecosystem?: boolean;
}

export type EngineerNoteKind = 'normalized' | 'duplicate' | 'command-effect' | 'replan' | 'policy';

export type EngineerEvent =
  | { type: 'step'; n: number; tool: string; summary: string }
  | { type: 'proposal'; n: number; preview: unknown }
  | { type: 'note'; n: number; kind: EngineerNoteKind; message: string }
  | { type: 'final'; markdown: string; steps: number }
  | { type: 'error'; code: 'MALFORMED_MODEL_OUTPUT' | 'STEP_LIMIT' | 'LOOP_NO_PROGRESS'; message: string };

const DEFAULT_MAX_STEPS = 14;
const DEFAULT_RESULT_CAP = 6_000;
const DEFAULT_NO_PROGRESS_LIMIT = 3;
const DEFAULT_MAX_REPLANS = 1;

const ECOSYSTEM_BLOCK = [
  'ECOSYSTEM CONTEXT: this workspace belongs to the MigraTeck/MigraHosting ecosystem.',
  'Respect its conventions: internal catalog is the source of truth, production is never',
  'touched from this loop, secrets are never read or printed, and deployment/DNS/billing',
  'actions are out of scope — recommend them for the operator instead of attempting them.',
].join(' ');

function protocolPrompt(input: EngineerInput, tools: EngineerToolInfo[]): string {
  const catalog = tools
    .map((t) => `- ${t.id}${t.readOnly ? ' (read-only)' : ''}: ${t.description} Input: ${t.inputHint}`)
    .join('\n');
  return [
    'You are the MigraPilot workspace engineer. You complete local software-engineering',
    `tasks inside the workspace rooted at: ${input.rootPath}`,
    input.ecosystem ? ECOSYSTEM_BLOCK : '',
    '',
    'TOOLS:',
    catalog,
    '',
    'RULES:',
    '- Reply with ONLY one JSON object, no prose, no code fences.',
    '- {"action":{"tool":"<id>","input":{...}}} to use a tool; {"final":"<markdown>"} to finish.',
    '- Every tool input must include "rootPath" set to the workspace root above.',
    '- Paths are WORKSPACE-RELATIVE (e.g. "src/index.js"), never absolute.',
    '- Line numbers are 1-BASED: startLine and endLine must be >= 1.',
    '- To create or change files use fs.proposeChangeset (op create/replace/patch/',
    '  delete) or edit.preview. A RECORDED PROPOSAL IS SUCCESS: it is the intended,',
    '  preview-only outcome — the operator applies it after approval, never you.',
    '  NEVER report a recorded proposal as a failure and NEVER tell the user to',
    '  create files manually; treat "proposal recorded" as the task being done.',
    '- Use command.run (argv array, e.g. ["npm","test"]) for builds/tests; only',
    '  allowlisted programs run; publish/deploy/release/push are refused.',
    '- NEVER repeat a tool call with identical input — its earlier result stands.',
    '- If a tool input is rejected, fix the input once; do not retry it unchanged.',
    '- Work autonomously: never ask the user for confirmation and never announce',
    '  a plan as your final answer — execute it with tools NOW.',
    '- For build/change tasks, only reply {"final":...} AFTER you have inspected',
    '  the workspace and produced edit.preview proposals for every file you would',
    '  create or change. Your final MUST summarize: what you inspected, commands',
    '  you ran, files proposed/changed, validation evidence, and any limitations.',
    '',
    `TASK: ${input.task}`,
  ].filter((l) => l !== '').join('\n');
}

/** Parse the model's step reply. Tolerates surrounding whitespace/fences. */
export function parseStep(text: string):
  | { kind: 'action'; tool: string; input: unknown }
  | { kind: 'final'; markdown: string }
  | { kind: 'malformed'; reason: string } {
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) body = fence[1]!.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { kind: 'malformed', reason: 'not valid JSON' };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.final === 'string') return { kind: 'final', markdown: obj.final };
  const action = obj.action as { tool?: unknown; input?: unknown } | undefined;
  if (action && typeof action.tool === 'string') {
    return { kind: 'action', tool: action.tool, input: action.input ?? {} };
  }
  return { kind: 'malformed', reason: 'neither {"action":...} nor {"final":...}' };
}

// ── canonicalization + normalization helpers (pure, string-based) ───────────────

/** Deterministic JSON: object keys sorted recursively, so equivalent inputs
 * (key order aside) canonicalize identically for duplicate detection. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function isAbsolutePath(p: string): boolean {
  return /^([\\/]|[A-Za-z]:[\\/])/.test(p);
}

function trimTrailingSep(p: string): string {
  return p.replace(/[\\/]+$/, '');
}

function underRoot(p: string, root: string): boolean {
  const nr = trimTrailingSep(root);
  return p === nr || p.startsWith(`${nr}/`) || p.startsWith(`${nr}\\`);
}

function relativize(p: string, root: string): string {
  const nr = trimTrailingSep(root);
  return p.slice(nr.length).replace(/^[\\/]+/, '');
}

type PathFix = { path: string } | { reject: string };
function fixPath(p: unknown, root: string, notes: string[]): PathFix {
  if (typeof p !== 'string') return { path: p as string };
  if (isAbsolutePath(p)) {
    if (underRoot(p, root)) {
      const rel = relativize(p, root);
      notes.push(`normalized absolute path to "${rel}"`);
      return { path: rel };
    }
    return { reject: `path "${p}" is outside the workspace root` };
  }
  if (p.split(/[\\/]/).includes('..')) return { reject: `path "${p}" escapes the workspace root` };
  return { path: p };
}

function fixLines(o: Record<string, unknown>, notes: string[]): void {
  if (typeof o.startLine === 'number' && o.startLine < 1) {
    notes.push('normalized startLine to 1 (line numbers are 1-based)');
    o.startLine = 1;
  }
  if (typeof o.endLine === 'number' && o.endLine < 1) {
    notes.push('normalized endLine to 1 (line numbers are 1-based)');
    o.endLine = 1;
  }
  if (typeof o.startLine === 'number' && typeof o.endLine === 'number' && o.endLine < o.startLine) {
    notes.push('normalized endLine up to startLine');
    o.endLine = o.startLine;
  }
}

/** Deterministic, bounded repair. NEVER invents missing arguments — a missing
 * required field is left for the tool's own schema validation to reject. */
export function normalizeInput(
  input: unknown,
  root: string,
): { input: Record<string, unknown>; notes: string[] } | { rejection: string } {
  const notes: string[] = [];
  const obj: Record<string, unknown> = { ...(input as Record<string, unknown> ?? {}) };
  if ('path' in obj) {
    const r = fixPath(obj.path, root, notes);
    if ('reject' in r) return { rejection: r.reject };
    obj.path = r.path;
  }
  fixLines(obj, notes);
  if (Array.isArray(obj.changes)) {
    const changes: unknown[] = [];
    for (const c of obj.changes) {
      const cc = { ...(c as Record<string, unknown>) };
      if ('path' in cc) {
        const r = fixPath(cc.path, root, notes);
        if ('reject' in r) return { rejection: r.reject };
        cc.path = r.path;
      }
      fixLines(cc, notes);
      changes.push(cc);
    }
    obj.changes = changes;
  }
  return { input: obj, notes };
}

/** Command-write policy: workspace-local side effects are fine; anything that
 * publishes, deploys, releases, or pushes off-machine is refused in-loop. */
const DENIED_COMMAND_TOKENS = /^(publish|deploy|release|push)$/i;
export function deniedCommandReason(command: unknown): string | null {
  if (!Array.isArray(command)) return null;
  const bad = command.find((a) => typeof a === 'string' && DENIED_COMMAND_TOKENS.test(a));
  return bad ? `command "${bad}" is an external-effect action (publish/deploy/release/push) and is refused in-loop` : null;
}

/** A final that is empty, trivially short, or a deferral/confirmation request. */
export function isWeakFinal(markdown: string): boolean {
  const t = markdown.trim();
  if (t.length < 40) return true;
  return /\b(please confirm|let me know|shall i|do you want|should i proceed|i will now|i'll now|continuing setup)\b/i.test(t);
}

function summarize(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function cap(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

const WEAK_FINAL_DIRECTIVE = [
  'That final was not acceptable — it must be a real completion report, not a plan or a question.',
  'Reply with {"final":"..."} whose markdown states: what you inspected, which commands you actually',
  'ran, which files you proposed or changed, any validation evidence, and any unresolved limitations.',
].join(' ');

/** A final that falsely reports failure when proposals were in fact recorded —
 * the model mistakes the preview-only outcome for an error and tells the user to
 * create files by hand. Detected only when >=1 proposal was emitted. */
const FALSE_FAILURE_FINAL =
  /\b(fail(?:ed|ure)?\s+to\s+(?:create|apply|write|generate)|could\s+not\s+(?:create|apply|write|generate)|un(?:able|successful)\s+to\s+(?:create|apply|write|generate)|creat(?:e|ing)\s+(?:the\s+)?(?:following\s+)?files?\s+(?:manually|yourself|by\s+hand)|manually\s+creat|do\s+it\s+manually|by\s+hand)\b/i;

const FALSE_FAILURE_DIRECTIVE = [
  'That final is WRONG. Your fs.proposeChangeset / edit.preview calls SUCCEEDED —',
  'they recorded an approvable proposal, which is the intended preview-only outcome',
  '(the operator applies it after approval, not you). Do NOT report it as a failure',
  'and do NOT tell the user to create files manually. Reply with {"final":"..."} that',
  'presents the proposed file(s) as ready to apply and summarizes what you proposed.',
].join(' ');

/** Run one engineering task as an event stream. Local-only by construction. */
export async function* runEngineerTask(deps: EngineerDeps, input: EngineerInput): AsyncGenerator<EngineerEvent> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const resultCap = deps.resultCap ?? DEFAULT_RESULT_CAP;
  const noProgressLimit = deps.noProgressLimit ?? DEFAULT_NO_PROGRESS_LIMIT;
  const maxReplans = deps.maxReplans ?? DEFAULT_MAX_REPLANS;
  const toolIds = new Set(deps.tools.map((t) => t.id));
  const transcript: string[] = [protocolPrompt(input, deps.tools)];

  const resultCache = new Map<string, unknown>(); // canonical call → recorded result
  const seenResultHashes = new Set<string>();
  let noProgressStreak = 0;
  let replans = 0;
  let toolStepCount = 0;
  let finalCorrected = false;
  let proposalsEmitted = 0;
  const stage = deps.stage ?? NOOP_STAGE_LOGGER;

  // Machine-authored truth footer: the model's prose can wrongly claim it
  // "applied" edits — the loop is preview-only, so we append the ground truth
  // whenever any proposal was surfaced. Deterministic; never model text.
  const APPLIED_FOOTER = '\n\n---\n_Proposed edits above were NOT applied — the engineer runs preview-only. Approve them to apply._';

  for (let n = 1; n <= maxSteps; n++) {
    let reply = await deps.complete(transcript.join('\n\n'));
    let step = parseStep(reply);
    if (step.kind === 'malformed') {
      transcript.push(`Your last reply was invalid (${step.reason}). Reply with ONLY the JSON protocol object.`);
      reply = await deps.complete(transcript.join('\n\n'));
      step = parseStep(reply);
      if (step.kind === 'malformed') {
        stage.log('error', { code: 'MALFORMED_MODEL_OUTPUT', n });
        yield { type: 'error', code: 'MALFORMED_MODEL_OUTPUT', message: `step ${n}: ${step.reason}` };
        return;
      }
    }

    if (step.kind === 'final') {
      if (isWeakFinal(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(WEAK_FINAL_DIRECTIVE);
        continue; // exactly one corrective retry
      }
      // A recorded proposal is success — if the model still reports failure or tells
      // the user to create files manually, correct it once…
      if (proposalsEmitted > 0 && FALSE_FAILURE_FINAL.test(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(FALSE_FAILURE_DIRECTIVE);
        continue;
      }
      // …and if it STILL does, override deterministically: the user must never be
      // told a proposal failed when it did not.
      let markdown = step.markdown;
      if (proposalsEmitted > 0 && FALSE_FAILURE_FINAL.test(markdown)) {
        markdown = `Proposed ${proposalsEmitted} change${proposalsEmitted === 1 ? '' : 's'} for your approval. Review the proposed file(s) above and approve to apply them to the workspace.`;
      }
      markdown = proposalsEmitted > 0 ? markdown + APPLIED_FOOTER : markdown;
      stage.log('final', { steps: toolStepCount, proposals: proposalsEmitted, replans });
      yield { type: 'final', markdown, steps: toolStepCount };
      return;
    }

    // Mutation policy: edit.apply / fs.applyChangeset are never executed by the
    // loop. edit.apply is substituted with its read-only preview; fs.applyChangeset
    // is substituted with fs.proposeChangeset — the loop only ever PROPOSES.
    const isProposal =
      step.tool === 'edit.apply' ||
      step.tool === 'edit.preview' ||
      step.tool === 'fs.applyChangeset' ||
      step.tool === 'fs.proposeChangeset';
    const tool =
      step.tool === 'edit.apply' ? 'edit.preview' : step.tool === 'fs.applyChangeset' ? 'fs.proposeChangeset' : step.tool;

    if (!toolIds.has(tool)) {
      transcript.push(`Tool "${step.tool}" does not exist. Available: ${[...toolIds].join(', ')}. Reply with the JSON protocol object.`);
      noProgressStreak++;
    } else {
      // Normalize + bounded repair (server-authoritative root wins regardless).
      const normalized = normalizeInput(step.input, input.rootPath);
      let progressed = false;
      if ('rejection' in normalized) {
        yield { type: 'note', n, kind: 'normalized', message: normalized.rejection };
        transcript.push(`Rejected: ${normalized.rejection}. Use a workspace-relative path and retry differently.`);
        noProgressStreak++;
      } else {
        for (const note of normalized.notes) yield { type: 'note', n, kind: 'normalized', message: note };
        const toolInput = { ...normalized.input, rootPath: input.rootPath };
        const canonical = `${tool} ${stableStringify(toolInput)}`;

        // Command-write policy (in-loop refusal for external-effect commands).
        const denied = tool === 'command.run' ? deniedCommandReason((toolInput as { command?: unknown }).command) : null;
        if (denied) {
          yield { type: 'note', n, kind: 'policy', message: denied };
          transcript.push(`Refused: ${denied}. Choose a workspace-local command or continue.`);
          noProgressStreak++;
        } else if (resultCache.has(canonical)) {
          // Duplicate suppression — return the recorded result, do not re-execute.
          yield { type: 'note', n, kind: 'duplicate', message: `${tool} was already run with these arguments; reusing the earlier result` };
          transcript.push(`${tool} ALREADY COMPLETED with those arguments; its earlier result stands. Do something different or reply with {"final":...}.`);
          noProgressStreak++;
        } else {
          yield { type: 'step', n, tool, summary: summarize(toolInput) };
          toolStepCount++;
          // loop-step + tool stages (metadata only — never the tool input/result).
          stage.log('loop-step', { n, tool });
          const before = tool === 'command.run' && deps.listFiles ? await deps.listFiles(input.rootPath).catch(() => []) : null;
          const toolStarted = Date.now();
          try {
            const result = await deps.executeTool(tool, toolInput);
            const stageName = tool === 'fs.proposeChangeset' || tool === 'edit.preview' ? 'proposal' : tool === 'command.run' ? 'validation' : 'tool';
            stage.log(stageName, { n, tool, durationMs: Date.now() - toolStarted, outcome: 'ok' });
            resultCache.set(canonical, result);
            if (isProposal) {
              yield { type: 'proposal', n, preview: result };
              proposalsEmitted++;
              progressed = true; // a concrete proposed change is progress
            }
            const hash = stableStringify(result);
            if (!seenResultHashes.has(hash)) {
              seenResultHashes.add(hash);
              progressed = true; // a novel observation is progress
            }
            if (before) {
              const after = await deps.listFiles!(input.rootPath).catch(() => []);
              const created = after.filter((f) => !before.includes(f));
              if (created.length) {
                yield { type: 'note', n, kind: 'command-effect', message: `created ${created.length} file(s): ${created.slice(0, 20).join(', ')}` };
                progressed = true; // command side effect is progress
              }
            }
            // For a proposal, prefix an explicit SUCCESS signal — the raw result
            // object alone led models to mistake the preview-only outcome for a
            // failure and tell the user to create files manually.
            transcript.push(
              isProposal
                ? `Result of ${tool}: PROPOSAL RECORDED SUCCESSFULLY (preview-only; the operator approves and applies it, not you). This is the intended outcome — do NOT call it a failure and do NOT ask the user to create files manually. Propose any remaining files, then reply {"final":...} presenting the proposed file(s) as ready to apply.\n${cap(stableStringify(result), resultCap)}`
                : `Result of ${tool}:\n${cap(stableStringify(result), resultCap)}\n\nContinue with the JSON protocol object.`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            stage.log('tool', { n, tool, durationMs: Date.now() - toolStarted, outcome: 'error', error: err instanceof Error ? err.name : 'error' });
            transcript.push(`Tool ${tool} FAILED: ${cap(message, 500)}\n\nFix the input once or do something different; do not repeat it unchanged.`);
          }
        }
        noProgressStreak = progressed ? 0 : noProgressStreak + 1;
      }
    }

    // No-progress detection → bounded re-plan → explicit termination.
    if (noProgressStreak >= noProgressLimit) {
      if (replans < maxReplans) {
        replans++;
        noProgressStreak = 0;
        yield { type: 'note', n, kind: 'replan', message: `no progress for ${noProgressLimit} steps — forcing a re-plan` };
        transcript.push(
          `You have made no progress for ${noProgressLimit} steps. Either take a MATERIALLY DIFFERENT action that advances the task, or reply now with {"final":...} summarizing what you did and what remains.`,
        );
      } else {
        stage.log('error', { code: 'LOOP_NO_PROGRESS', replans });
        yield { type: 'error', code: 'LOOP_NO_PROGRESS', message: `no progress after ${replans} re-plan(s); stopping` };
        return;
      }
    }
  }
  stage.log('error', { code: 'STEP_LIMIT', steps: toolStepCount });
  yield { type: 'error', code: 'STEP_LIMIT', message: `stopped after ${maxSteps} steps without a final answer` };
}
