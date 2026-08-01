// Agentic answer loop — the Copilot/Claude-style path. The model is given
// READ-ONLY workspace tools (search / read / list / find / git_status) and
// iterates: it decides what to look up, we execute the tool with the SAME
// deterministic, workspace-contained runner the inspection path uses, feed the
// real result back, and repeat until the model answers from gathered evidence.
//
// Guarantees:
//  - READ-ONLY: only inspection ops run; no edit/apply/command tool is exposed,
//    so a turn can never mutate the workspace and needs no approval.
//  - BOUNDED: a hard step cap + per-tool result cap + wall-clock signal, so the
//    loop always terminates and returns partial evidence rather than hanging.
//  - GROUNDED: the model is instructed to cite `path:line` and not invent.
//
// Talks to Ollama's NATIVE `/api/chat` (reliable `tool_calls`), with a fallback
// that also accepts a JSON tool-call emitted in `content` (some local models do
// this instead of populating `tool_calls`). © MigraTeck LLC.

import * as path from 'node:path';
import { runInspection, type InspectOp } from './inspectRoutes.js';
import { retrieveContext } from '../retrieval/retrieve.js';
import { EvidenceLedger } from './grounding/evidenceLedger.js';
import { verifyAnswer, type GroundedClaim, type RejectedClaim } from './grounding/claimVerifier.js';
import {
  AnswerTimeline,
  type AnswerRunTimings,
  type ModelCallTiming,
  type RunPhase,
  type TimeoutCategory,
  type TimeoutEvidence,
} from './answerTimings.js';

export interface AgenticStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgenticResult {
  /** The answer to show — verified, with unsupported claims removed. */
  answer: string;
  /** What the model actually wrote, before the grounding gate. Kept for audit. */
  rawAnswer: string;
  steps: AgenticStep[];
  model: string;
  runner: 'local' | 'cloud';
  stepsUsed: number;
  claims: GroundedClaim[];
  rejected: RejectedClaim[];
  /** True when no claim survived as direct evidence. */
  refused: boolean;
  timings: AnswerRunTimings;
  /** Present when a model-call or run budget was exhausted. */
  timeout?: TimeoutEvidence;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: RawToolCall[];
  name?: string;
}

interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: unknown };
}

const MAX_STEPS_DEFAULT = 8;
const TOOL_RESULT_CAP = 1800; // chars fed back for a search/find/list result
const READ_RESULT_CAP = 8000; // chars fed back for a `read` (files need real context)
export const PER_CALL_TIMEOUT_MS = 150_000; // budget for ONE model call (local models can be slow)
export const OVERALL_DEADLINE_MS = 360_000; // hard ceiling for the whole loop

/**
 * Smallest slice of a per-call budget worth starting a synthesis call with.
 *
 * Expressed as a FRACTION rather than a fixed number of milliseconds so it tracks
 * whatever budget the run is actually operating under — a fixed 20s floor silently
 * disables synthesis for any deployment or test that runs on a smaller budget,
 * which is the same class of bug as the absolute timeouts this slice is unpicking.
 */
const MIN_SYNTHESIS_BUDGET_RATIO = 0.1;

/** Read-only tool surface exposed to the model (OpenAI/Ollama function schema). */
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Content search (grep) across the workspace. Returns matching file paths with line numbers and a preview. Use to locate where a symbol/string is used or defined.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Literal text to search for (case-insensitive).' },
          limit: { type: 'integer', description: 'Max matches (default 10).' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read a range of lines from a workspace file (path relative to the workspace root). Use after search to see the real code.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Workspace-relative file path.' },
          startLine: { type: 'integer' },
          endLine: { type: 'integer' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find',
      description: 'Find files/directories by name or path (filename search, supports * globs). Distinct from content search.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          kind: { type: 'string', enum: ['file', 'dir', 'any'] },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list',
      description: 'List entries of a workspace directory (path relative to the root; omit for the root).',
      parameters: { type: 'object', properties: { path: { type: 'string' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Current git branch and the list of changed/untracked files.',
      parameters: { type: 'object', properties: {} },
    },
  },
] as const;

const TOOL_NAMES = new Set<string>(TOOLS.map((t) => t.function.name));

const SYSTEM_PROMPT =
  'You are MigraPilot, a workspace-aware coding assistant with READ-ONLY tools to inspect the user\'s actual repository: ' +
  'search (content grep), read (file lines), find (filenames), list (directory), git_status. ' +
  'Gather real evidence with the tools BEFORE answering a question about the code — do not answer repository questions from memory or assumption. ' +
  'Efficient flow: use `find` to locate a file by name, or `search` to find where a symbol is used; then ALWAYS `read` the specific file you identified before drawing a conclusion. ' +
  'SEARCH STRATEGY: the question is written in plain English, but code uses IDENTIFIERS. Do NOT just search the question\'s literal phrase (e.g. "deep agent mode" or "gather evidence") — those rarely appear verbatim in code. Instead search LIKELY CODE NAMES for the feature: single distinctive words ("agentic", "answer", "retrieve", "inspect"), camelCase/snake_case function names, route paths ("/api/ai/"), and file-name guesses via `find`. If a search returns 0 hits, PIVOT to a different related word or a `find` by filename — never repeat near-identical phrases. ' +
  'Crucially: if you have identified the file that answers the question, READ it — never conclude "I would need to read X" when you can just read X. ' +
  '\n\nSTRICT ANTI-FABRICATION RULES (a wrong confident answer is worse than "not found"):\n' +
  '1. ONLY name or cite a file AFTER you have actually READ it in this session. Never cite a file you only saw in a search result list but did not read.\n' +
  '2. NEVER write hypothetical, example, illustrative, or placeholder code. Never emit placeholder tokens. Only show code you literally read from a file.\n' +
  '3. NEVER describe a generic/typical architecture (e.g. "might use Winston/Sentry/Kubernetes", "could be Express"). Only state what the files you READ actually show.\n' +
  '4. This workspace may contain DUPLICATE, ARCHIVED, BACKUP, or LEGACY copies of code. Prefer current source; name the exact file path you are describing so the user knows which copy. If files conflict, say so.\n' +
  '5. If the tools do not surface the specific code that answers the question, say EXACTLY that: state what you searched for / read, and that you could not find the answer in this workspace. Do NOT fill the gap with inference.\n' +
  'When you have enough real evidence, give a concise Markdown answer and cite each repository fact as `path:line` from a file you read.\n' +
  '\nHOW YOUR ANSWER IS CHECKED (this is enforcement, not advice): every sentence is verified against the exact text these tools returned. ' +
  'A sentence that names a file, symbol or technology absent from that text is DELETED from your answer, as is a factual sentence with no `path:line` citation in its paragraph. ' +
  'So: put a `path:line` citation in every paragraph that states repository behaviour, name only files you read, and if you are reasoning rather than reporting, hedge it explicitly ("likely", "appears to") so it survives as labelled inference instead of being removed.';

/** Map a model tool call to a read-only inspection op and execute it. Exported
 * for testing — it exercises the whole read-only tool surface without a model. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): Promise<{ ok: boolean; summary: string; feedback: string; data?: unknown }> {
  const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  try {
    let op: InspectOp;
    const req: Record<string, unknown> = { rootPath: workspaceRoot };
    switch (name) {
      case 'search':
        op = 'search';
        req.query = s(args.query) ?? '';
        req.limit = Math.min(20, Math.max(1, n(args.limit) ?? 10));
        if (!req.query) return { ok: false, summary: 'search: empty query', feedback: 'Error: `query` is required.' };
        break;
      case 'read':
        op = 'read';
        req.path = s(args.path);
        if (n(args.startLine)) req.startLine = n(args.startLine);
        if (n(args.endLine)) req.endLine = n(args.endLine);
        if (!req.path) return { ok: false, summary: 'read: missing path', feedback: 'Error: `path` is required.' };
        break;
      case 'find':
        op = 'find';
        req.query = s(args.query) ?? '';
        req.kind = s(args.kind) ?? 'any';
        if (!req.query) return { ok: false, summary: 'find: empty query', feedback: 'Error: `query` is required.' };
        break;
      case 'list':
        op = 'list';
        if (s(args.path)) req.path = s(args.path);
        break;
      case 'git_status':
        op = 'git_status';
        break;
      default:
        return { ok: false, summary: `unknown tool ${name}`, feedback: `Error: no such tool \`${name}\`.` };
    }
    const { data } = await runInspection({ ...req, op } as Parameters<typeof runInspection>[0]);
    const cap = name === 'read' ? READ_RESULT_CAP : TOOL_RESULT_CAP;
    const feedback = JSON.stringify(data).slice(0, cap);
    // `data` is returned alongside the model-facing feedback so the caller can
    // record structured evidence. The feedback string is capped for the model; the
    // ledger keeps the real spans, because the gate must check claims against what
    // was RETRIEVED, not against a truncated JSON rendering of it.
    return { ok: true, summary: summarize(name, args, data), feedback, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${name} failed: ${message}`, feedback: `Error: ${message}` };
  }
}

/** Fold one tool result into the evidence ledger, per op result shape. */
export function recordEvidence(ledger: EvidenceLedger, tool: string, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const d = data as Record<string, unknown>;
  switch (tool) {
    case 'read': {
      const p = typeof d.path === 'string' ? d.path : '';
      const start = typeof d.startLine === 'number' ? d.startLine : 1;
      const end = typeof d.endLine === 'number' ? d.endLine : start;
      const content = typeof d.content === 'string' ? d.content : '';
      if (p && content) ledger.recordRead(p, start, end, content);
      break;
    }
    case 'search': {
      for (const raw of Array.isArray(d.matches) ? d.matches : []) {
        const m = raw as { path?: unknown; line?: unknown; preview?: unknown };
        if (typeof m.path === 'string' && typeof m.line === 'number' && typeof m.preview === 'string') {
          ledger.recordSearchMatch(m.path, m.line, m.preview);
        }
      }
      break;
    }
    case 'find': {
      // A found filename proves the path exists — never what is inside it.
      for (const raw of Array.isArray(d.matches) ? d.matches : []) {
        const m = raw as { path?: unknown };
        if (typeof m.path === 'string') ledger.notePath(m.path);
      }
      break;
    }
    case 'list': {
      const dir = typeof d.dir === 'string' && d.dir !== '.' ? d.dir : '';
      for (const raw of Array.isArray(d.entries) ? d.entries : []) {
        const e = raw as { name?: unknown };
        if (typeof e.name === 'string') ledger.notePath(dir ? `${dir}/${e.name}` : e.name);
      }
      break;
    }
    case 'git_status': {
      for (const raw of Array.isArray(d.files) ? d.files : []) {
        const f = raw as { path?: unknown };
        if (typeof f.path === 'string') ledger.notePath(f.path);
      }
      break;
    }
    default:
      break;
  }
}

function summarize(name: string, args: Record<string, unknown>, data: unknown): string {
  const d = data as { matches?: unknown[]; entries?: unknown[]; files?: unknown[] };
  if (name === 'search' || name === 'find') return `${name}(${String(args.query ?? '')}) → ${d.matches?.length ?? 0} hit(s)`;
  if (name === 'list') return `list(${String(args.path ?? '.')}) → ${d.entries?.length ?? 0} entr(ies)`;
  if (name === 'git_status') return `git_status → ${d.files?.length ?? 0} changed file(s)`;
  if (name === 'read') return `read(${String(args.path ?? '')})`;
  return name;
}

/** Extract tool calls from a model message — native `tool_calls`, or a single
 * JSON tool-call emitted in `content` (a common local-model behaviour). */
function extractToolCalls(msg: ChatMessage): Array<{ name: string; args: Record<string, unknown> }> {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  for (const tc of msg.tool_calls ?? []) {
    const name = tc.function?.name;
    if (!name || !TOOL_NAMES.has(name)) continue;
    calls.push({ name, args: parseArgs(tc.function?.arguments) });
  }
  if (calls.length === 0 && msg.content) {
    const parsed = tryParseContentToolCall(msg.content);
    if (parsed) calls.push(parsed);
  }
  return calls;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? (o as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/** Some local models emit a tool call in `content` instead of populating the
 * native `tool_calls` field. Two shapes are accepted:
 *   1. whole-content JSON  — {"name":"search","arguments":{...}}
 *   2. Qwen/Hermes XML text — <function=read><parameter=path>src/x.js</parameter></function>
 *      (qwen3-coder:30b does exactly this; without it, /deep never executes a
 *      tool and leaks the raw call text as the "answer"). Prose is never treated
 *      as a call — the tag must name a KNOWN tool. */
export function tryParseContentToolCall(content: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = content.trim();
  // (1) Whole-content JSON object naming a known tool.
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const o = JSON.parse(trimmed) as { name?: string; arguments?: unknown; parameters?: unknown };
      if (typeof o.name === 'string' && TOOL_NAMES.has(o.name)) {
        return { name: o.name, args: parseArgs(o.arguments ?? o.parameters) };
      }
    } catch {
      /* not JSON — fall through to XML */
    }
  }
  // (2) Qwen/Hermes XML-style tool call anywhere in the content (optionally
  //     wrapped in <tool_call>…</tool_call>). Parse the FIRST call to a known tool.
  const fn = /<function\s*=\s*["']?([A-Za-z_][\w-]*)["']?\s*>([\s\S]*?)<\/function>/i.exec(content);
  if (fn && TOOL_NAMES.has(fn[1]!)) {
    const name = fn[1]!;
    const body = fn[2]!;
    const args: Record<string, unknown> = {};
    const paramRe = /<parameter\s*=\s*["']?([A-Za-z_][\w-]*)["']?\s*>([\s\S]*?)<\/parameter>/gi;
    let m: RegExpExecArray | null;
    while ((m = paramRe.exec(body)) !== null) {
      const val = m[2]!.trim();
      args[m[1]!] = /^-?\d+$/.test(val) ? Number(val) : val; // coerce ints (e.g. limit)
    }
    // Some models put JSON args directly inside <function=…>{...}</function>.
    if (Object.keys(args).length === 0) {
      const inner = body.trim();
      if (inner.startsWith('{') && inner.endsWith('}')) return { name, args: parseArgs(inner) };
    }
    return { name, args };
  }
  return null;
}

/**
 * A model call that ran out of budget, carrying WHICH budget.
 *
 * Without the category, a per-call exhaustion and a whole-run deadline arrive at
 * the route as the same anonymous `AbortError` and get reported as the same
 * generic failure — which is precisely how ~331s of two exhausted call budgets was
 * misread as one outer timeout.
 */
export class ModelBudgetExhausted extends Error {
  constructor(
    readonly category: TimeoutCategory,
    readonly budgetMs: number,
  ) {
    super(`model call exceeded its ${category === 'model_call_timeout' ? `${budgetMs}ms call budget` : category}`);
    this.name = 'ModelBudgetExhausted';
  }
}

/** Arm a per-call budget on top of the loop signal, reporting which one fired. */
function armCallBudget(
  loopSignal: AbortSignal,
  budgetMs: number,
  loopCause: () => TimeoutCategory,
): { signal: AbortSignal; release(): void; cause(): TimeoutCategory | undefined } {
  const controller = new AbortController();
  let cause: TimeoutCategory | undefined;
  const timer = setTimeout(() => {
    cause = 'model_call_timeout';
    controller.abort();
  }, budgetMs);
  const onLoopAbort = (): void => {
    cause = loopCause();
    controller.abort();
  };
  if (loopSignal.aborted) onLoopAbort();
  else loopSignal.addEventListener('abort', onLoopAbort, { once: true });
  return {
    signal: controller.signal,
    release: () => {
      clearTimeout(timer);
      loopSignal.removeEventListener('abort', onLoopAbort);
    },
    cause: () => cause,
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

async function callModel(
  nativeChatUrl: string,
  model: string,
  messages: ChatMessage[],
  useTools: boolean,
  loopSignal: AbortSignal,
  budgetMs: number,
  loopCause: () => TimeoutCategory,
): Promise<ChatMessage> {
  // Each model call gets its OWN budget so a multi-hop loop against a slow local
  // model is never cut off mid-turn; the loop-level signal still aborts the call
  // when the overall deadline or the caller cancels.
  const budget = armCallBudget(loopSignal, budgetMs, loopCause);
  try {
    const res = await fetch(nativeChatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(useTools ? { tools: TOOLS } : {}),
        options: { temperature: 0.1 },
      }),
      signal: budget.signal,
    });
    if (!res.ok) throw new Error(`agent model HTTP ${res.status}`);
    const json = (await res.json()) as { message?: ChatMessage };
    return json.message ?? { role: 'assistant', content: '' };
  } catch (err) {
    const cause = budget.cause();
    if (cause && isAbortError(err)) throw new ModelBudgetExhausted(cause, budgetMs);
    throw err;
  } finally {
    budget.release();
  }
}

/** Stream the final synthesis token-by-token. Ollama native `/api/chat` streams
 * newline-delimited JSON, each line `{message:{content}, done}`. No tools here —
 * this is the answer turn only. */
async function* streamModel(
  nativeChatUrl: string,
  model: string,
  messages: ChatMessage[],
  loopSignal: AbortSignal,
  budgetMs: number,
  loopCause: () => TimeoutCategory,
): AsyncGenerator<string> {
  const budget = armCallBudget(loopSignal, budgetMs, loopCause);
  try {
    const res = await fetch(nativeChatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.1 } }),
      signal: budget.signal,
    });
    if (!res.ok || !res.body) throw new Error(`agent model stream HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
          const text = obj.message?.content;
          if (text) yield text;
        } catch {
          /* ignore a partial/non-JSON line */
        }
      }
    }
  } catch (err) {
    const cause = budget.cause();
    if (cause && isAbortError(err)) throw new ModelBudgetExhausted(cause, budgetMs);
    throw err;
  } finally {
    budget.release();
  }
}

/** Derive Ollama's native `/api/chat` URL from the configured `.../v1` base. */
export function nativeChatUrlFrom(providerBaseUrl: string): string {
  const base = providerBaseUrl.replace(/\/+$/, '');
  const root = base.replace(/\/v1$/, '');
  return `${root}/api/chat`;
}

export interface AgenticOptions {
  prompt: string;
  workspaceRoot: string;
  model: string;
  providerBaseUrl: string;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Which runner the resolved model actually belongs to. Reported, never guessed. */
  runner?: 'local' | 'cloud';
  /** Budget for ONE model call. Overridable so timeout behaviour is testable. */
  perCallTimeoutMs?: number;
  /** Ceiling for the whole run. */
  overallDeadlineMs?: number;
  /** Injected monotonic clock — tests assert real timing fields without waiting. */
  clock?: () => number;
}

/** Streamed event from the agentic loop — drives a live "agent mode" UI. */
export type AgenticEvent =
  | { type: 'route'; model: string; runner: 'local' | 'cloud' }
  | { type: 'phase'; phase: RunPhase }
  | { type: 'step'; step: AgenticStep }
  | { type: 'token'; text: string }
  | {
      type: 'grounding';
      claims: GroundedClaim[];
      rejected: RejectedClaim[];
      refused: boolean;
      evidence: { readPaths: string[]; spanCount: number; knownPathCount: number };
      /** What the model wrote before the gate — for audit, not for display. */
      rawAnswer: string;
    }
  | { type: 'timeout'; evidence: TimeoutEvidence }
  | { type: 'timings'; timings: AnswerRunTimings }
  | { type: 'done'; stepsUsed: number; model: string };

/** Build the initial messages, seeding deterministic retrieval so even a weak
 * local model starts from REAL code instead of flailing with guessed searches.
 * Every seeded chunk is recorded as evidence: it is text the run really retrieved
 * and put in front of the model, so a claim may legitimately rest on it. */
async function seedMessages(opts: AgenticOptions, ledger: EvidenceLedger, timeline: AnswerTimeline): Promise<ChatMessage[]> {
  let seededEvidence = '';
  const endEnumeration = timeline.beginPhase('enumeration');
  try {
    const seed = await retrieveContext({ query: opts.prompt, workspaceRoot: opts.workspaceRoot, feature: 'chat', maxChunks: 5 });
    endEnumeration();
    const endSelection = timeline.beginPhase('evidence_selection');
    const chunks = seed.chunks.filter((c) => c.source === 'grep');
    if (chunks.length) {
      const rel = (p: string): string => {
        const r = path.relative(opts.workspaceRoot, p);
        return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p;
      };
      for (const c of chunks) ledger.recordSeed(rel(c.path), c.startLine, c.endLine, c.snippet);
      seededEvidence =
        '\n\nRelevant code already located in the workspace (read more with the `read` tool if needed):\n' +
        chunks.map((c) => `--- ${rel(c.path)}:${c.startLine}-${c.endLine} ---\n${c.snippet}`).join('\n\n');
    }
    endSelection();
  } catch {
    /* seeding is best-effort */
    endEnumeration();
  }
  const endPrompt = timeline.beginPhase('prompt_construction');
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.prompt + seededEvidence },
  ];
  endPrompt();
  return messages;
}

/** Verify the model's text against the ledger and emit the terminal events. */
async function* emitVerified(
  raw: string,
  ledger: EvidenceLedger,
  timeline: AnswerTimeline,
  opts: AgenticOptions,
  stepsUsed: number,
  runner: 'local' | 'cloud',
): AsyncGenerator<AgenticEvent> {
  yield { type: 'phase', phase: 'answer_verification' };
  const endVerify = timeline.beginPhase('answer_verification');
  const verified = verifyAnswer(raw, ledger, { question: opts.prompt });
  endVerify();
  timeline.noteRepeatedReads(ledger.repeatedReads());
  timeline.markPhase('complete');

  // The runtime's own measured report is appended AFTER the gate: it is not a
  // model claim, and passing it through a checker built for model claims would be
  // checking our own instrumentation against the model's evidence.
  const evidence = timeline.timeoutEvidence;
  const note = evidence ? `\n\n${describeTimeout(evidence)}` : '';
  yield { type: 'token', text: verified.answer + note };
  yield {
    type: 'grounding',
    claims: verified.claims,
    rejected: verified.rejected,
    refused: verified.refused,
    evidence: verified.evidence,
    rawAnswer: raw,
  };
  if (evidence) yield { type: 'timeout', evidence };
  yield { type: 'timings', timings: timeline.snapshot() };
  yield { type: 'done', stepsUsed, model: opts.model };
  void runner;
}

/** Truthful, measured account of a budget exhaustion — never "the request timed out". */
export function describeTimeout(e: TimeoutEvidence): string {
  if (e.category === 'client_abort') return '> ⚠️ The run was cancelled by the client before it finished.';
  const what =
    e.category === 'model_call_timeout'
      ? `model call #${e.callIndex} used its full ${Math.round(e.callBudgetMs / 1000)}s budget (${Math.round(e.elapsedMs / 1000)}s elapsed) without returning`
      : `the run reached its overall deadline after ${Math.round(e.runElapsedMs / 1000)}s`;
  const scope = `${e.contextFileCount} file(s) were represented in that call's context; ${e.modelCallsCompleted} model call(s) had completed.`;
  const partial = e.partialEvidenceAvailable
    ? 'The answer above is limited to the evidence gathered before that point.'
    : 'No workspace evidence had been gathered before that point.';
  return `> ⚠️ Budget exhausted at \`${e.lastObservedPhase}\`: ${what}. ${scope} ${partial}`;
}

/**
 * The agentic tool loop as a stream of events. Tool calls in a single turn run in
 * PARALLEL.
 *
 * The final answer is BUFFERED, verified against {@link EvidenceLedger}, and only
 * then emitted. Token-by-token streaming of the raw model text was the nicer UX,
 * but a grounding gate that streams before it checks has not gated anything — the
 * unsupported sentence is already on screen. Live tool steps still stream, so the
 * run remains legible while it works.
 */
export async function* streamAgentic(opts: AgenticOptions): AsyncGenerator<AgenticEvent> {
  const maxSteps = opts.maxSteps && opts.maxSteps > 0 ? opts.maxSteps : MAX_STEPS_DEFAULT;
  const perCallBudgetMs = opts.perCallTimeoutMs && opts.perCallTimeoutMs > 0 ? opts.perCallTimeoutMs : PER_CALL_TIMEOUT_MS;
  const overallDeadlineMs = opts.overallDeadlineMs && opts.overallDeadlineMs > 0 ? opts.overallDeadlineMs : OVERALL_DEADLINE_MS;
  const runner = opts.runner ?? 'local';
  const nativeChatUrl = nativeChatUrlFrom(opts.providerBaseUrl);

  const timeline = new AnswerTimeline(opts.clock);
  const ledger = new EvidenceLedger();

  const controller = new AbortController();
  let loopCause: TimeoutCategory = 'overall_deadline';
  const cause = (): TimeoutCategory => loopCause;
  const timer = setTimeout(() => {
    loopCause = 'overall_deadline';
    controller.abort();
  }, overallDeadlineMs);
  if (opts.signal) {
    opts.signal.addEventListener(
      'abort',
      () => {
        loopCause = 'client_abort';
        controller.abort();
      },
      { once: true },
    );
  }

  let toolSteps = 0;
  let budgetExhausted = false;

  try {
    yield { type: 'route', model: opts.model, runner };
    yield { type: 'phase', phase: 'enumeration' };
    const messages = await seedMessages(opts, ledger, timeline);
    const evidenceLog: string[] = []; // compiled tool results for a clean synthesis
    let consecutiveEmpty = 0;
    let step = 0;

    for (; step < maxSteps; step += 1) {
      // When the budget is nearly spent, tell the model to stop searching and
      // answer with what it has — prevents a thorough model from looping to the
      // cap and forcing a fragile last-ditch synthesis.
      if (step === maxSteps - 2) {
        messages.push({ role: 'user', content: 'You are almost out of tool budget. Do at most one more lookup if essential, then ANSWER now with citations.' });
      }

      const handle = timeline.beginCall({
        phase: 'tool_loop',
        model: opts.model,
        runner,
        budgetMs: perCallBudgetMs,
        messages,
        contextFiles: ledger.readPaths,
        toolStepsBefore: toolSteps,
      });
      let msg: ChatMessage;
      let record: ModelCallTiming;
      try {
        msg = await callModel(nativeChatUrl, opts.model, messages, true, controller.signal, perCallBudgetMs, cause);
        record = handle.end('ok', { toolStepsAfter: toolSteps });
      } catch (err) {
        if (err instanceof ModelBudgetExhausted) {
          const record = handle.end('timeout', { timeoutCategory: err.category, toolStepsAfter: toolSteps });
          timeline.recordTimeout(record, err.category, !ledger.isEmpty);
          budgetExhausted = true;
          break;
        }
        handle.end('error', { toolStepsAfter: toolSteps });
        throw err;
      }
      const calls = extractToolCalls(msg);

      if (calls.length === 0) {
        const answer = (msg.content ?? '').trim();
        if (answer) {
          yield* emitVerified(answer, ledger, timeline, opts, step, runner);
          return;
        }
        // Empty turn (a reasoning-model hiccup, or it emitted only `thinking`).
        // Don't give up — nudge once or twice to either use a tool or answer.
        consecutiveEmpty += 1;
        if (consecutiveEmpty <= 2 && step < maxSteps - 1) {
          messages.push({
            role: 'user',
            content: 'You returned nothing. Either call a tool to gather more evidence, or write your final answer now, citing the specific files you have read.',
          });
          continue;
        }
        break; // give up on the loop → forced synthesis below
      }
      consecutiveEmpty = 0;

      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      // Execute every tool call in this turn CONCURRENTLY (speed), preserving order.
      yield { type: 'phase', phase: 'tool_execution' };
      const endTools = timeline.beginPhase('tool_execution');
      const results = await Promise.all(calls.map((c) => executeTool(c.name, c.args, opts.workspaceRoot)));
      endTools();
      for (let i = 0; i < calls.length; i += 1) {
        const call = calls[i]!;
        const result = results[i]!;
        toolSteps += 1;
        if (result.ok) {
          recordEvidence(ledger, call.name, result.data);
          evidenceLog.push(`### ${result.summary}\n${result.feedback}`);
        }
        yield { type: 'step', step: { tool: call.name, args: call.args, ok: result.ok, summary: result.summary } };
        messages.push({ role: 'tool', name: call.name, content: result.feedback });
      }
      // Stamped only now: the tool steps a call PRODUCED are not known when the
      // call returns, and `before === after` on every row would say nothing.
      record.toolStepsAfter = toolSteps;
    }

    // A call that burned its whole budget having gathered nothing has no synthesis
    // to attempt: a second full budget on the same model and the same context is
    // exactly the ~331s double-spend this instrumentation exists to expose.
    if (budgetExhausted && ledger.isEmpty) {
      yield* emitVerified('', ledger, timeline, opts, toolSteps, runner);
      return;
    }

    // Step budget exhausted (or empty answer) — force a grounded final answer.
    // Use a CLEAN two-message conversation (no assistant/tool-call history): some
    // models (e.g. gpt-oss) return empty `content` when asked to answer at the end
    // of a long tool-call exchange, but answer reliably from a plain evidence
    // block. We feed the gathered evidence directly.
    const evidenceBlock = evidenceLog.length
      ? evidenceLog.join('\n\n').slice(0, 24_000)
      : '(no tool evidence was gathered)';
    const synthesisMessages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Question: ${opts.prompt}\n\n` +
          `Evidence gathered from the workspace with read-only tools:\n${evidenceBlock}\n\n` +
          'This is your FINAL turn. You have NO more tools — you cannot search or read anything further. ' +
          'Do NOT say "let me check", "I\'ll look", or propose next steps; there are none. ' +
          'Based ONLY on the evidence above, do exactly one of:\n' +
          '(a) Give the answer now, citing files as `path:line`; or\n' +
          '(b) State plainly that the evidence is insufficient to answer, and list the specific files you did find (some code may exist in multiple duplicate copies). ' +
          'Never invent files, code, or behaviour.',
      },
    ];

    const minCallBudgetMs = Math.max(1, Math.floor(perCallBudgetMs * MIN_SYNTHESIS_BUDGET_RATIO));
    const synthesisBudgetMs = remainingCallBudget(timeline, perCallBudgetMs, overallDeadlineMs, budgetExhausted);
    if (synthesisBudgetMs < minCallBudgetMs) {
      yield* emitVerified('', ledger, timeline, opts, toolSteps, runner);
      return;
    }

    yield { type: 'phase', phase: 'model_inference' };
    const streamHandle = timeline.beginCall({
      phase: 'final_synthesis_stream',
      model: opts.model,
      runner,
      budgetMs: synthesisBudgetMs,
      messages: synthesisMessages,
      contextFiles: ledger.readPaths,
      toolStepsBefore: toolSteps,
    });
    let streamed = '';
    try {
      for await (const chunk of streamModel(nativeChatUrl, opts.model, synthesisMessages, controller.signal, synthesisBudgetMs, cause)) {
        streamed += chunk;
      }
      streamHandle.end('ok', { toolStepsAfter: toolSteps });
    } catch (err) {
      if (err instanceof ModelBudgetExhausted) {
        const record = streamHandle.end('timeout', { timeoutCategory: err.category, toolStepsAfter: toolSteps });
        timeline.recordTimeout(record, err.category, !ledger.isEmpty);
        // Whatever streamed before the budget ran out is still real model output;
        // the gate decides whether any of it survives.
        yield* emitVerified(streamed, ledger, timeline, opts, toolSteps, runner);
        return;
      }
      streamHandle.end('error', { toolStepsAfter: toolSteps });
      throw err;
    }

    // Reasoning models (e.g. gpt-oss) sometimes stream only `thinking` and emit
    // no `content` in a streamed call. Fall back to a NON-streamed call so the
    // answer is reliable rather than empty.
    if (!streamed.trim()) {
      const retryBudgetMs = remainingCallBudget(timeline, perCallBudgetMs, overallDeadlineMs, budgetExhausted);
      if (retryBudgetMs >= minCallBudgetMs) {
        const retryHandle = timeline.beginCall({
          phase: 'final_synthesis_retry',
          model: opts.model,
          runner,
          budgetMs: retryBudgetMs,
          messages: synthesisMessages,
          contextFiles: ledger.readPaths,
          toolStepsBefore: toolSteps,
        });
        try {
          const finalMsg = await callModel(nativeChatUrl, opts.model, synthesisMessages, false, controller.signal, retryBudgetMs, cause);
          retryHandle.end('ok', { toolStepsAfter: toolSteps });
          streamed = (finalMsg.content ?? '').trim();
        } catch (err) {
          if (!(err instanceof ModelBudgetExhausted)) {
            retryHandle.end('error', { toolStepsAfter: toolSteps });
            throw err;
          }
          const record = retryHandle.end('timeout', { timeoutCategory: err.category, toolStepsAfter: toolSteps });
          timeline.recordTimeout(record, err.category, !ledger.isEmpty);
        }
      }
    }

    // An empty synthesis produces no claims, so the gate refuses and states the
    // gap from the ledger — which is exactly the truthful report the old
    // hand-written fallback was trying to approximate.
    yield* emitVerified(streamed, ledger, timeline, opts, toolSteps || maxSteps, runner);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Budget for the next model call.
 *
 * Bounded by BOTH the per-call budget and what is left of the overall deadline —
 * and halved once a previous call has already exhausted a full budget, because
 * handing the same model the same context and a fresh full budget is what turned
 * one 150s exhaustion into a 331s failure.
 */
function remainingCallBudget(timeline: AnswerTimeline, perCallBudgetMs: number, overallDeadlineMs: number, alreadyExhausted: boolean): number {
  const remaining = overallDeadlineMs - timeline.elapsed();
  const ceiling = alreadyExhausted ? Math.floor(perCallBudgetMs / 2) : perCallBudgetMs;
  return Math.max(0, Math.min(ceiling, remaining));
}

/** Non-streaming convenience wrapper — collects the stream into a single result.
 * Used by the JSON route and by tests. */
export async function agenticAnswer(opts: AgenticOptions): Promise<AgenticResult> {
  const steps: AgenticStep[] = [];
  let answer = '';
  let rawAnswer = '';
  let stepsUsed = 0;
  let model = opts.model;
  let runner: 'local' | 'cloud' = opts.runner ?? 'local';
  let claims: GroundedClaim[] = [];
  let rejected: RejectedClaim[] = [];
  let refused = false;
  let timings: AnswerRunTimings | undefined;
  let timeout: TimeoutEvidence | undefined;

  for await (const ev of streamAgentic(opts)) {
    if (ev.type === 'step') steps.push(ev.step);
    else if (ev.type === 'token') answer += ev.text;
    else if (ev.type === 'route') runner = ev.runner;
    else if (ev.type === 'grounding') {
      claims = ev.claims;
      rejected = ev.rejected;
      refused = ev.refused;
      rawAnswer = ev.rawAnswer;
    } else if (ev.type === 'timeout') timeout = ev.evidence;
    else if (ev.type === 'timings') timings = ev.timings;
    else if (ev.type === 'done') {
      stepsUsed = ev.stepsUsed;
      model = ev.model;
    }
  }
  return {
    answer: answer.trim(),
    rawAnswer,
    steps,
    model,
    runner,
    stepsUsed,
    claims,
    rejected,
    refused,
    timings: timings ?? new AnswerTimeline(opts.clock).snapshot(),
    ...(timeout ? { timeout } : {}),
  };
}
