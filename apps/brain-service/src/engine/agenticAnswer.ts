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

export interface AgenticStep {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

export interface AgenticResult {
  answer: string;
  steps: AgenticStep[];
  model: string;
  stepsUsed: number;
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
const PER_CALL_TIMEOUT_MS = 150_000; // budget for ONE model call (local models can be slow)
const OVERALL_DEADLINE_MS = 360_000; // hard ceiling for the whole loop

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
  'When you have enough real evidence, give a concise Markdown answer and cite each repository fact as `path:line` from a file you read.';

/** Map a model tool call to a read-only inspection op and execute it. Exported
 * for testing — it exercises the whole read-only tool surface without a model. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  workspaceRoot: string,
): Promise<{ ok: boolean; summary: string; feedback: string }> {
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
    return { ok: true, summary: summarize(name, args, data), feedback };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${name} failed: ${message}`, feedback: `Error: ${message}` };
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

/** Some models emit `{"name":"search","arguments":{...}}` as the whole content
 * instead of populating `tool_calls`. Accept that ONLY when the entire content
 * is such an object naming a known tool (never treat a prose answer as a call). */
export function tryParseContentToolCall(content: string): { name: string; args: Record<string, unknown> } | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const o = JSON.parse(trimmed) as { name?: string; arguments?: unknown; parameters?: unknown };
    if (typeof o.name === 'string' && TOOL_NAMES.has(o.name)) {
      return { name: o.name, args: parseArgs(o.arguments ?? o.parameters) };
    }
  } catch {
    /* not a tool call */
  }
  return null;
}

async function callModel(
  nativeChatUrl: string,
  model: string,
  messages: ChatMessage[],
  useTools: boolean,
  loopSignal: AbortSignal,
): Promise<ChatMessage> {
  // Each model call gets its OWN timeout so a multi-hop loop against a slow local
  // model is never cut off mid-turn; the loop-level signal still aborts the call
  // when the overall deadline or the caller cancels.
  const callController = new AbortController();
  const timer = setTimeout(() => callController.abort(), PER_CALL_TIMEOUT_MS);
  const onLoopAbort = (): void => callController.abort();
  loopSignal.addEventListener('abort', onLoopAbort, { once: true });
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
      signal: callController.signal,
    });
    if (!res.ok) throw new Error(`agent model HTTP ${res.status}`);
    const json = (await res.json()) as { message?: ChatMessage };
    return json.message ?? { role: 'assistant', content: '' };
  } finally {
    clearTimeout(timer);
    loopSignal.removeEventListener('abort', onLoopAbort);
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
): AsyncGenerator<string> {
  const callController = new AbortController();
  const timer = setTimeout(() => callController.abort(), PER_CALL_TIMEOUT_MS);
  const onLoopAbort = (): void => callController.abort();
  loopSignal.addEventListener('abort', onLoopAbort, { once: true });
  try {
    const res = await fetch(nativeChatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: true, options: { temperature: 0.1 } }),
      signal: callController.signal,
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
  } finally {
    clearTimeout(timer);
    loopSignal.removeEventListener('abort', onLoopAbort);
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
}

/** Streamed event from the agentic loop — drives a live "agent mode" UI. */
export type AgenticEvent =
  | { type: 'route'; model: string }
  | { type: 'step'; step: AgenticStep }
  | { type: 'token'; text: string }
  | { type: 'done'; stepsUsed: number; model: string };

/** Build the initial messages, seeding deterministic retrieval so even a weak
 * local model starts from REAL code instead of flailing with guessed searches. */
async function seedMessages(opts: AgenticOptions): Promise<ChatMessage[]> {
  let seededEvidence = '';
  try {
    const seed = await retrieveContext({ query: opts.prompt, workspaceRoot: opts.workspaceRoot, feature: 'chat', maxChunks: 5 });
    const chunks = seed.chunks.filter((c) => c.source === 'grep');
    if (chunks.length) {
      const rel = (p: string): string => {
        const r = path.relative(opts.workspaceRoot, p);
        return r && !r.startsWith('..') ? r.replace(/\\/g, '/') : p;
      };
      seededEvidence =
        '\n\nRelevant code already located in the workspace (read more with the `read` tool if needed):\n' +
        chunks.map((c) => `--- ${rel(c.path)}:${c.startLine}-${c.endLine} ---\n${c.snippet}`).join('\n\n');
    }
  } catch {
    /* seeding is best-effort */
  }
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: opts.prompt + seededEvidence },
  ];
}

/** The agentic tool loop as a stream of events. Tool calls in a single turn run
 * in PARALLEL. The final answer is streamed token-by-token. */
export async function* streamAgentic(opts: AgenticOptions): AsyncGenerator<AgenticEvent> {
  const maxSteps = opts.maxSteps && opts.maxSteps > 0 ? opts.maxSteps : MAX_STEPS_DEFAULT;
  const nativeChatUrl = nativeChatUrlFrom(opts.providerBaseUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERALL_DEADLINE_MS);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });

  try {
    yield { type: 'route', model: opts.model };
    const messages = await seedMessages(opts);
    const readFiles = new Set<string>(); // files actually read this run
    const evidenceLog: string[] = []; // compiled tool results for a clean synthesis
    let consecutiveEmpty = 0;

    for (let step = 0; step < maxSteps; step += 1) {
      // When the budget is nearly spent, tell the model to stop searching and
      // answer with what it has — prevents a thorough model from looping to the
      // cap and forcing a fragile last-ditch synthesis.
      if (step === maxSteps - 2) {
        messages.push({ role: 'user', content: 'You are almost out of tool budget. Do at most one more lookup if essential, then ANSWER now with citations.' });
      }
      const msg = await callModel(nativeChatUrl, opts.model, messages, true, controller.signal);
      const calls = extractToolCalls(msg);

      if (calls.length === 0) {
        const answer = (msg.content ?? '').trim();
        if (answer) {
          yield { type: 'token', text: answer };
          yield { type: 'done', stepsUsed: step, model: opts.model };
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
      const results = await Promise.all(calls.map((c) => executeTool(c.name, c.args, opts.workspaceRoot)));
      for (let i = 0; i < calls.length; i += 1) {
        const call = calls[i]!;
        const result = results[i]!;
        if (call.name === 'read' && result.ok && typeof call.args.path === 'string') readFiles.add(call.args.path);
        if (result.ok) evidenceLog.push(`### ${result.summary}\n${result.feedback}`);
        yield { type: 'step', step: { tool: call.name, args: call.args, ok: result.ok, summary: result.summary } };
        messages.push({ role: 'tool', name: call.name, content: result.feedback });
      }
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
    let streamed = '';
    for await (const chunk of streamModel(nativeChatUrl, opts.model, synthesisMessages, controller.signal)) {
      streamed += chunk;
      yield { type: 'token', text: chunk };
    }
    // Reasoning models (e.g. gpt-oss) sometimes stream only `thinking` and emit
    // no `content` in a streamed call. Fall back to a NON-streamed call so the
    // answer is reliable rather than empty.
    if (!streamed.trim()) {
      const finalMsg = await callModel(nativeChatUrl, opts.model, synthesisMessages, false, controller.signal);
      let finalText = (finalMsg.content ?? '').trim();
      if (!finalText) {
        // Even the forced synthesis was empty. Be TRUTHFUL about what happened
        // rather than fabricating — report the files actually read so the user
        // has a real starting point.
        finalText = readFiles.size
          ? `I could not synthesize a confident answer, but I read these files while investigating — the answer is likely in one of them:\n${[...readFiles].map((f) => `- \`${f}\``).join('\n')}`
          : 'I could not find the specific code that answers this in the workspace. Try naming a file, folder, or symbol to narrow it down.';
      }
      yield { type: 'token', text: finalText };
    }
    yield { type: 'done', stepsUsed: maxSteps, model: opts.model };
  } finally {
    clearTimeout(timer);
  }
}

/** Non-streaming convenience wrapper — collects the stream into a single result.
 * Used by the JSON route and by tests. */
export async function agenticAnswer(opts: AgenticOptions): Promise<AgenticResult> {
  const steps: AgenticStep[] = [];
  let answer = '';
  let stepsUsed = 0;
  let model = opts.model;
  for await (const ev of streamAgentic(opts)) {
    if (ev.type === 'step') steps.push(ev.step);
    else if (ev.type === 'token') answer += ev.text;
    else if (ev.type === 'done') {
      stepsUsed = ev.stepsUsed;
      model = ev.model;
    }
  }
  return { answer: answer.trim(), steps, model, stepsUsed };
}
