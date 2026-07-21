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
import { lintChangeset, summarizeDefects } from '../tools/changesetLint.js';
import { FinalAnswerStreamer } from './finalAnswerStream.js';

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
  /** Optional token-streaming completion. When present the loop uses it and
   * reports the final ANSWER as it is generated, so the user is not left
   * watching nothing during a long local generation. Falls back to `complete`
   * wherever it is absent, so every existing caller is unaffected. */
  completeStream?(prompt: string): AsyncIterable<string>;
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
  /** Prior turns of the conversation, oldest first. The unified agent handles
   * ordinary chat too, so it must carry the same memory the chat path had —
   * otherwise "now build it" loses what "it" refers to. */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** Code excerpts retrieved for this message BEFORE the loop starts.
   *
   * The agent can search, but a naive keyword search over a large monorepo finds
   * the wrong "lint" (observed: matched allowed-scripts config and a deployment
   * doc instead of changesetLint.ts). The chat path had tuned lexical ranking —
   * definition-first, filename bonus, copy-path penalty — and routing ordinary
   * turns here dropped it. Seeding those excerpts restores the grounding AND
   * usually saves a search round. */
  context?: Array<{ path: string; startLine: number; endLine: number; snippet: string }>;
}

export type EngineerNoteKind = 'normalized' | 'duplicate' | 'command-effect' | 'replan' | 'policy' | 'quality';

export type EngineerEvent =
  | { type: 'step'; n: number; tool: string; summary: string }
  | { type: 'proposal'; n: number; preview: unknown }
  | { type: 'note'; n: number; kind: EngineerNoteKind; message: string }
  | { type: 'token'; text: string }
  | { type: 'final'; markdown: string; steps: number; streamedPrefix?: boolean }
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
  const excerpts = (input.context ?? [])
    .map((c) => `--- ${c.path}:${c.startLine}-${c.endLine}\n${c.snippet}`)
    .join('\n\n');
  const history = (input.history ?? [])
    .map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${m.text}`)
    .join('\n');
  return [
    'You are MigraPilot, a workspace agent on the user\'s own machine, working in the',
    `workspace rooted at: ${input.rootPath}`,
    'You handle EVERY kind of request in this conversation — questions, explanations,',
    'discussion and planning as well as building and changing code. You have tools, so',
    'you never have to guess about this workspace and you never lack access to it.',
    input.ecosystem ? ECOSYSTEM_BLOCK : '',
    '',
    'TOOLS:',
    catalog,
    '',
    'DECIDE WHAT THE USER ACTUALLY WANTS, THEN ACT:',
    '- A QUESTION or a request to explain/compare/discuss/plan that does NOT depend on',
    '  the code in this workspace (general programming, concepts, advice, chit-chat):',
    '  answer it IMMEDIATELY with {"final":"<markdown>"}. Do NOT call any tool and do',
    '  NOT propose files — a tool call here only wastes the user\'s time.',
    '- A QUESTION ABOUT THIS WORKSPACE (how does X work here, where is Y, what does this',
    '  repo do, what changed): answer ONLY from real code, citing `path:line`.',
    excerpts
      ? '  Excerpts were already retrieved for this message below — read them FIRST and answer'
      : '  Your FIRST reply MUST be a tool call, never a final:',
    excerpts
      ? '  from them if they suffice; search only for what they genuinely do not cover.'
      : '  start with workspace.search on the most distinctive keywords in their message,',
    excerpts
      ? '  A large repository is NORMAL: never ask the user where to look or to name a file.'
      : '  then file.readRange on the best hit — and only then answer. A large or unfamiliar',
    excerpts ? '' : '  repository is NORMAL: search it, never ask the user where to look.',
    '  Do NOT propose file changes for a question.',
    '- A REQUEST TO BUILD, CHANGE, FIX, REFACTOR, SCAFFOLD or RUN something: do the work',
    '  with the tools below, ending in a proposed changeset. This includes requests that',
    '  are phrased as a plan, a mission, a numbered slice, a quoted instruction, or an',
    '  aside like "you can now build it" — the WORDING never decides; the INTENT does.',
    '  DO NOT SEARCH FOR SOMETHING YOU ARE BEING ASKED TO CREATE. A thing you are told',
    '  to build does not exist yet — that is WHY they asked — so "I could not find it in',
    '  the workspace" is never a valid answer, and neither is asking which files it lives',
    '  in. Pick sensible defaults and propose complete, runnable files immediately.',
    '- To see WHAT FILES EXIST use workspace.list. It is the only tool that can answer',
    '  "what is in this repo/folder" — searching content cannot, and git.status shows',
    '  only CHANGES, not contents. NEVER state that a directory is empty, that a file is',
    '  absent, or that the repo lacks apps/packages/services/prisma/docker/tests unless',
    '  workspace.list actually showed you that. Guessing a listing is a serious error.',
    '- To FIND code use workspace.search, then file.readRange on the best hit.',
    '  diagnostics.get reports COMPILER ERRORS and never locates code — it is the wrong',
    '  tool for "where is X" or "what does Y do", and finding nothing with it proves nothing.',
    '- When the intent is genuinely ambiguous, prefer DOING the work over asking.',
    '- WRITING ABOUT A FILE IS NOT CREATING IT. If your final says anything was created,',
    '  added, implemented, proposed or recorded, you MUST have called fs.proposeChangeset',
    '  in THIS turn. Describing file contents in prose creates nothing, and reporting it',
    '  as done is a serious error — call the tool instead.',
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
    '- BUILD FROM SCRATCH when the task is to build/create/scaffold something NEW',
    '  (an app, script, page, component, game). An EMPTY or unrelated workspace is',
    '  NORMAL, not an error — you are creating from nothing. Do NOT require any',
    '  pre-existing code, do NOT ask the user for clarification or more details, and',
    '  do NOT give up or report failure because no files exist. Immediately CREATE',
    '  the files with fs.proposeChangeset: pick sensible defaults and a runnable',
    '  layout, and write COMPLETE, WORKING file contents (never empty stubs or',
    '  "TODO"). Example — a web app => index.html + styles.css + app.js that actually',
    '  run in a browser; a Node script => the script file plus a minimal package.json',
    '  if needed. Prefer zero-dependency, immediately-runnable code.',
    '- Do NOT spend steps running npm/git/search on an empty or unfamiliar workspace',
    '  before creating files — for a build-new task, propose the files FIRST. Use',
    '  command.run (argv array, e.g. ["npm","test"]) for builds/tests only AFTER',
    '  files exist; only allowlisted programs run; publish/deploy/release/push refused.',
    '- COMPLETE every cross-file change. For a RENAME or REFACTOR of a symbol,',
    '  FIRST search the whole workspace for every usage (definition, imports,',
    '  exports, and all call sites), then include EVERY file that references it in',
    '  ONE changeset — not just the file that defines it. A rename that changes the',
    '  definition but misses a usage BREAKS the build; a partial refactor is a bug,',
    '  not a done task. The same applies to signature changes, moves, and deletes:',
    '  update or remove every reference you found.',
    '- NEVER repeat a tool call with identical input — its earlier result stands.',
    '- If a tool input is rejected, fix the input once; do not retry it unchanged.',
    '- Work autonomously: when the user asked for WORK, never ask for confirmation and',
    '  never announce a plan as your final answer — execute it with tools NOW. (When the',
    '  user asked a question or asked FOR a plan, the answer itself is the deliverable.)',
    '- For a BUILD/CHANGE request, reply {"final":...} only AFTER you have proposed',
    '  (via fs.proposeChangeset or edit.preview) every file the task needs. That final',
    '  MUST summarize the files you proposed and any validation — for a build-new task',
    '  that is the files you CREATED, never an inspection report or an apology about an',
    '  empty workspace. (For a question, finishing immediately is correct.)',
    '',
    excerpts
      ? [
          'CODE RETRIEVED FOR THIS MESSAGE (real excerpts from this workspace, ranked',
          'by relevance — this is a SAMPLE, not the whole repo):',
          excerpts,
          '',
          'If these excerpts answer the QUESTION, answer NOW from them and cite `path:line`',
          '— no search needed. If the specific fact you need is not in them, THEN search for',
          'it; never claim the repo lacks something merely because these excerpts omit it.',
          'If the user asked you to BUILD or CHANGE something, these excerpts are BACKGROUND',
          'ONLY: they are never a reason to search, to ask which system is meant, or to say',
          'you could not find it. Build it.',
          '',
        ].join('\n')
      : '',
    history ? `CONVERSATION SO FAR:\n${history}\n` : '',
    `THE USER'S CURRENT MESSAGE: ${input.task}`,
  ].filter((l) => l !== '').join('\n');
}

/** Drop backslashes that JSON does not permit as escapes.
 *
 * JSON allows only `\" \\ \/ \b \f \n \r \t \uXXXX`. A model writing JavaScript
 * or shell content into a string field often emits `\'`, which makes the WHOLE
 * step unparseable and fails the run. Applied only after a genuine parse
 * failure, so it can never alter text that was already valid JSON. */
/** Escape raw control characters that appear INSIDE a JSON string.
 *
 * JSON forbids a literal newline in a string, but models write multi-line
 * markdown straight into `{"final":"…"}` all the time. Observed live: a correct,
 * fully-cited answer to a repository question was discarded as malformed purely
 * because its bullet list used real newlines instead of `\n`. */
export function repairJsonControlChars(text: string): string {
  const ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t', '\b': '\\b', '\f': '\\f' };
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\' && inString) {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      out += ch;
      continue;
    }
    if (inString && ch < ' ') {
      out += ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
      continue;
    }
    out += ch;
  }
  return out;
}

export function repairJsonEscapes(text: string): string {
  // Scan escape PAIRS left to right so a legitimate `\\` is consumed as one unit
  // and its partner is never mistaken for the start of another escape.
  return text.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (match, escaped: string) =>
    escaped.length > 1 || '"\\/bfnrt'.includes(escaped) ? match : escaped,
  );
}

/** Parse the model's step reply. Tolerates surrounding whitespace/fences. */
export function parseStep(text: string, opts: { lenient?: boolean } = {}):
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
    // Some local models (qwen3-coder:30b) ignore the JSON protocol and emit their
    // NATIVE XML tool-call syntax instead — the same behaviour that silently broke
    // /deep. Accept it here too rather than failing the whole run as malformed.
    const xml = parseXmlToolCall(text);
    if (xml) return xml;
    // Last resort: repair invalid escapes. Models routinely write file CONTENT
    // with source-language escapes that JSON forbids — `"Time\'s up!"` inside a
    // proposed .js file killed an entire otherwise-perfect build run. The text is
    // already unparseable, so dropping the stray backslash can only improve it.
    try {
      parsed = JSON.parse(repairJsonEscapes(repairJsonControlChars(body)));
    } catch {
      return { kind: 'malformed', reason: 'not valid JSON' };
    }
  }
  // A bare JSON string IS the answer, just without its wrapper — models emit
  // `"Monads are …"` verbatim. Accepted only as a LAST RESORT (see below).
  if (typeof parsed === 'string') {
    return opts.lenient
      ? { kind: 'final', markdown: parsed }
      : { kind: 'malformed', reason: 'a bare string, not the protocol object' };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.final === 'string') return { kind: 'final', markdown: obj.final };
  const action = obj.action as { tool?: unknown; input?: unknown } | undefined;
  if (action && typeof action.tool === 'string') {
    return { kind: 'action', tool: action.tool, input: action.input ?? {} };
  }
  // LAST RESORT ONLY: the same answer under a different key (`response`,
  // `answer`, `markdown`, …), e.g. the live `{"response":"…"}`.
  //
  // Deliberately gated behind `lenient`, which only the post-retry parse sets.
  // Accepting an alias on the FIRST parse made the agent stop early: a chatty
  // `{"response":"I'll build it"}` was taken as the finished answer, and a build
  // that used to propose three files proposed nothing. Demanding the protocol
  // first (the retry usually complies) and falling back only when the run would
  // otherwise DIE keeps both properties.
  if (!opts.lenient) return { kind: 'malformed', reason: 'neither {"action":...} nor {"final":...}' };
  for (const alias of ['response', 'answer', 'markdown', 'text', 'final_answer', 'output']) {
    const value = obj[alias];
    if (typeof value === 'string' && value.trim()) return { kind: 'final', markdown: value };
  }
  return { kind: 'malformed', reason: 'neither {"action":...} nor {"final":...}' };
}

/** Qwen/Hermes-style tool call emitted as XML text instead of the JSON protocol:
 *   <function=file.readRange><parameter=path>a.ts</parameter>
 *                            <parameter=startLine>1</parameter></function>
 * Parameter values are coerced (ints, and JSON when the value is an object/array
 * — e.g. fs.proposeChangeset's `ops`). JSON args directly inside the tag also
 * work. Returns null when the text is not such a call. */
export function parseXmlToolCall(
  text: string,
): { kind: 'action'; tool: string; input: unknown } | { kind: 'final'; markdown: string } | null {
  const fn = /<function\s*=\s*["']?([\w.$-]+)["']?\s*>([\s\S]*?)<\/function>/i.exec(text);
  if (!fn) return null;
  const tool = fn[1]!;
  const inner = fn[2]!;
  // A model sometimes wraps its finish this way; treat it as a final answer.
  if (/^final$/i.test(tool)) return { kind: 'final', markdown: inner.trim() };

  const input: Record<string, unknown> = {};
  const paramRe = /<parameter\s*=\s*["']?([\w$-]+)["']?\s*>([\s\S]*?)<\/parameter>/gi;
  let m: RegExpExecArray | null;
  while ((m = paramRe.exec(inner)) !== null) {
    const raw = m[2]!.trim();
    let value: unknown = raw;
    if (/^-?\d+$/.test(raw)) value = Number(raw);
    else if (/^(?:true|false)$/i.test(raw)) value = raw.toLowerCase() === 'true';
    else if (/^[[{]/.test(raw)) {
      try {
        value = JSON.parse(raw);
      } catch {
        /* keep the raw string */
      }
    }
    input[m[1]!] = value;
  }
  if (Object.keys(input).length === 0) {
    const t = inner.trim();
    if (/^[[{]/.test(t)) {
      try {
        return { kind: 'action', tool, input: JSON.parse(t) };
      } catch {
        /* fall through with empty input */
      }
    }
  }
  return { kind: 'action', tool, input };
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

/** The agent finished without using any tool (an ordinary answer) but produced
 * no text at all. Ask for the answer itself — NOT for a completion report. */
const EMPTY_FINAL_DIRECTIVE =
  'Your final was empty. Reply with {"final":"..."} containing your actual answer to the user\'s message.';

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

// ── phantom work ──────────────────────────────────────────────────────────────
// A final that talks as though this turn produced artifacts, checked ONLY when
// the agent used no tools at all — where such a claim cannot possibly be true.
//
// Observed live: asked "you can now build the system" after a design discussion,
// the agent proposed nothing and replied "…*app.js* starts the countdown … No
// further actions are pending." Nothing existed. Same phantom report as the
// fabricated Slice 0 run, reached from the tool-capable path.

/** Phrases that announce the turn is DONE — these read as completion whether or
 * not a verb like "created" appears, so they are matched against the whole text. */
const COMPLETION_SIGNAL =
  /\bno (?:further|other|additional) actions?\b|\b(?:task|slice|build|setup) (?:is )?complete\b|\bproposal recorded\b/i;

/** Claims that specific artifacts came into existence. */
const WORK_CLAIM = new RegExp(
  [
    /\bi(?:'ve| have)? (?:created|added|wrote|written|generated|implemented|built|scaffolded|set up)\b/.source,
    /\b(?:has|have) been (?:created|added|generated|written|implemented|built)\b/.source,
    /\b(?:created|proposed) files?\b|\bfiles? (?:created|proposed)\b/.source,
    /\bproposed (?:the )?(?:changeset|files?)\b|\bthe (?:proposed )?changeset\b/.source,
    // "- **index.html**: Created a basic HTML structure …" — a per-file bullet
    // list written in the PAST TENSE is a completion report, whatever the verb.
    /^\s*[-*\d.]+\s*\**`?[\w.-]+\.[a-z]{1,5}`?\**\s*:?\s*(?:created|added|implemented|wrote|generated|built)\b/.source,
  ].join('|'),
  'im',
);

/** Words that flip a claim into an honest NEGATIVE report. "No commands run; no
 * files proposed" is the loop working correctly — it must never be flagged. */
const NEGATION = /\b(?:no|not|nothing|none|never|haven't|hasn't|didn't|won't|cannot|can't)\b/i;

/** Does this final claim artifacts were produced? Evaluated per sentence/line so
 * a negated statement is not read as a claim. */
export function claimsPhantomWork(markdown: string): boolean {
  if (COMPLETION_SIGNAL.test(markdown)) return true;
  return markdown
    .split(/(?<=[.!?])\s+|\n/)
    .some((sentence) => WORK_CLAIM.test(sentence) && !NEGATION.test(sentence));
}

const PHANTOM_WORK_DIRECTIVE = [
  'STOP. You called NO tools this turn, so nothing was created, changed or proposed —',
  'that final describes work that does not exist. Do NOT describe files as if they are',
  'there. Either call fs.proposeChangeset NOW with the COMPLETE contents of every file',
  'the user asked for (this is the correct move if they asked you to build anything,',
  'including a follow-up like "you can now build it" that refers to something discussed',
  'earlier in the conversation), or reply with a final that plainly states you have not',
  'done the work and asks nothing.',
].join(' ');

/** The turn ended by putting the work back on the USER — refusing for lack of
 * information, asking them to supply context, or announcing an inspection it
 * never performed. Checked only when ZERO tools ran, where all three are the
 * same failure: the agent holds the tools that would have settled it.
 *
 * Observed live on the real monorepo: "I need to inspect the code to answer
 * accurately… Please guide me on where to look so I can fulfill your request."
 * That is the old tool-less dead-end wearing a politer sentence, and an earlier
 * refusal-only pattern did not catch it — which is why the trigger is about the
 * SHAPE of the ending (deferring to the user) rather than any one phrase. */
const DEFERRED_TO_USER =
  /\b(?:sorry|i (?:do not|don't) have|i (?:cannot|can't|am unable to)|unable to (?:provide|determine|report)|(?:not|don't have) enough (?:information|context)|need more (?:information|details|context)|(?:could|can|would) you (?:please )?(?:specify|clarify|provide|tell|point|share|guide|confirm)|please (?:guide|tell|let me know|provide|specify|clarify|point|share|confirm)|if you can provide|i need to (?:inspect|check|look|see|search|examine|review)|where (?:should|can) i (?:look|start)|let me know (?:where|which|what|the))\b/i;

/** Safe whichever way the turn actually should have gone: it tells the model to
 * use its tools IF the answer depends on the workspace, and to answer directly
 * if it does not — so a false positive costs one round, never a wrong answer. */
const LOOK_FIRST_DIRECTIVE = [
  'That final puts the work back on the user. Never ask them to look something up,',
  'name a file, or supply context you can obtain yourself, and never merely announce',
  'that you need to inspect something.',
  'If they asked you to BUILD, CREATE or CHANGE something, searching for it is the',
  'WRONG move and "I could not find it" is not a valid answer — the thing does not',
  'exist yet, that is why they asked. Call fs.proposeChangeset NOW with complete,',
  'runnable file contents, choosing sensible defaults instead of asking which ones.',
  'If they asked a QUESTION about this workspace, call a read-only tool NOW (start',
  'with workspace.search on the most distinctive keywords, then file.readRange on the',
  'best hit). If the question does not depend on the workspace, answer from your own',
  'knowledge. If a specific fact genuinely is not there, say which fact is missing and',
  'what you checked — never a blanket refusal.',
].join(' ');

/** Name a tool the final CLAIMS a result from but which never actually ran.
 *
 * Observed live: after calling only `diagnostics.get`, the agent answered "the
 * workspace search did not find any specific information…" — reporting the
 * outcome of a search it never performed, then giving up. Unlike prose claims,
 * this is exactly checkable: the loop knows which tools it executed. Matches the
 * dotted id and its spoken form ("workspace.search" / "workspace search"). */
export function claimedUnrunTool(
  markdown: string,
  executed: ReadonlySet<string>,
  available: ReadonlyArray<string>,
): string | null {
  for (const id of available) {
    if (executed.has(id)) continue;
    const [group, verb] = id.split('.');
    if (!group || !verb) continue;
    const spoken = new RegExp(`\\b${group}[.\\s]${verb}\\b`, 'i');
    if (spoken.test(markdown)) return id;
  }
  return null;
}

/** Is this unparseable reply simply the ANSWER, written as prose instead of in
 * the protocol? Substantial text with no half-formed tool call in it. Kept
 * strict: a fragment of protocol means the model was trying to act, and acting
 * on a guess would be far worse than reporting the protocol break. */
export function looksLikeProseAnswer(reply: string): boolean {
  const t = reply.trim();
  if (t.length < 80) return false;
  if (/"(?:action|tool|input)"\s*:/.test(t)) return false;
  if (/<function\s*=/i.test(t)) return false;
  return true;
}

/** Machine-authored close-out when the model cannot produce a usable final but
 * real proposals were recorded. Never claims more than the loop actually did. */
function salvagedFinal(proposals: number, why: string): string {
  return [
    `Recorded ${proposals} proposal${proposals === 1 ? '' : 's'} above (${why}, so this summary is machine-generated).`,
    'The proposed file(s) are intact and ready for review — nothing has been applied.',
  ].join(' ');
}

/** Did the final actually USE the code it was handed?
 *
 * Structural, not phrase-based: we know exactly which files were seeded, so we
 * can check whether the answer cites any of them. A turn that was given
 * definition-grade evidence, called no tools, and cited none of it has neither
 * used the evidence nor gathered any — it is a non-answer by construction.
 *
 * This replaces an earlier phrase-matching guard for "the excerpts do not cover
 * it", which slipped on every rewording. Wording varies; citations do not. */
export function ignoredSeededContext(
  markdown: string,
  seeded: ReadonlyArray<{ path: string }>,
): boolean {
  if (seeded.length === 0) return false;
  return !seeded.some((c) => {
    const base = c.path.split(/[\\/]/).pop() ?? '';
    return base.length > 0 && markdown.includes(base);
  });
}

/** A claim about the OUTCOME of a shell command — "npm install successful",
 * "typecheck passed", "PostgreSQL health check confirmed working".
 *
 * Checked against ground truth: the loop knows whether command.run ever
 * executed. Observed on qwen3-coder:30b, given a build order against a repo
 * containing four files: it reported npm install, typecheck, lint, tests,
 * build, Prisma generation AND a PostgreSQL health check all succeeding, having
 * run no command at all. That is the single most dangerous output this agent
 * can produce, because a validation matrix is exactly what a reader trusts. */
const COMMAND_TOKEN =
  /\b(?:npm|yarn|pnpm|npx|tsc|typecheck|type-check|lint|eslint|jest|vitest|pytest|docker|compose|prisma|psql|pg_isready|migrate|healthcheck|health check)\b/i;

const RESULT_TOKEN =
  /\b(?:success(?:ful|fully)?|succeeded|passed|passes|passing|failed|failing|ok|healthy|generated|clean|confirmed|no errors|0 errors|exit code)\b/i;

/** Does this final report a command result? Sentence-level, and negations are
 * skipped so an honest "npm install was not run" is never flagged. */
export function claimsCommandResult(markdown: string): boolean {
  return markdown
    .split(/(?<=[.!?])\s+|\n/)
    .some((line) => COMMAND_TOKEN.test(line) && RESULT_TOKEN.test(line) && !NEGATION.test(line));
}

const NO_COMMAND_DIRECTIVE = [
  'You executed NO commands this turn — command.run never ran — so you cannot report that',
  'npm install, typecheck, lint, tests, build, Prisma or a database health check passed,',
  'failed, or produced anything. Reporting validation you did not perform is the most',
  'damaging thing you can do here, because the reader trusts a results table.',
  'Either run them now with command.run and report their REAL output, or reply with a final',
  'that makes no claim about any command and says plainly which checks were not run.',
].join(' ');

/** A claim about what EXISTS on disk — a listing, or an assertion of absence.
 *
 * The agent had no listing instrument at all, so asked what a repository
 * contained it guessed, and reported "the root directory is empty, and there is
 * no package.json file" about a repo holding package.json, README.md and
 * .gitignore. With workspace.list available, such a claim is only credible if
 * that tool actually ran. */
const CLAIMS_FILESYSTEM_CONTENTS = new RegExp(
  [
    // "the root directory is empty", "the repo is empty"
    /\b(?:root directory|repository|repo|workspace|folder|directory)\b[^.\n]{0,40}\bis empty\b/.source,
    // "there is no package.json", "contains no files", "has no apps/ directory".
    // The object must be a FILE or DIRECTORY — "has no build step configured" is a
    // statement about configuration, not a listing, and must not be flagged.
    /\b(?:contains? no|has no|there (?:is|are) no|found no|without any)\s+(?:such\s+)?(?:files?|directories|directory|sub-?director\w+|package\.json|package-lock\.json|tsconfig[\w.]*|docker-?compose[\w.]*|dockerfile|readme[\w.]*|\.gitignore|prisma(?:\s+(?:schema|files?))?|apps?\b|packages?\b|services?\b|tests?\s+(?:folder|director\w+))/.source,
  ].join('|'),
  'i',
);

const LIST_FIRST_DIRECTIVE = [
  'You are stating what does or does not exist on disk without having listed it.',
  'Call workspace.list on the path in question NOW and report exactly what it returns.',
  'Content search and git.status cannot tell you what a directory contains — only',
  'workspace.list can, and an invented listing is worse than no answer at all.',
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
  const executedTools = new Set<string>(); // for cross-checking claims made in the final
  let finalCorrected = false;
  let proposalsEmitted = 0;
  let filesCreatedByCommand = false; // command.run side effects are real work too
  let lintCorrections = 0;
  const MAX_LINT_CORRECTIONS = 2; // bounded self-correction on defective proposals
  const stage = deps.stage ?? NOOP_STAGE_LOGGER;

  // Machine-authored truth footer: the model's prose can wrongly claim it
  // "applied" edits — the loop is preview-only, so we append the ground truth
  // whenever any proposal was surfaced. Deterministic; never model text.
  const APPLIED_FOOTER = '\n\n---\n_Proposed edits above were NOT applied — the engineer runs preview-only. Approve them to apply._';

  // Ground truth for a final that reports checks which never executed.
  const NO_COMMAND_FOOTER =
    '\n\n---\n**⚠️ No commands were run.** Any install, typecheck, lint, test, build, migration or health-check result stated above did not happen — nothing was executed this turn.';

  // Ground truth for a final that still describes work after zero tool calls.
  const NO_WORK_FOOTER =
    '\n\n---\n**⚠️ Nothing was created or changed.** No tool ran during this turn, so any files named above do not exist. Ask again to have them actually built.';

  // One completion, reported as it arrives. The streamer emits nothing until the
  // reply is confirmed to be a final answer, so a tool call never leaks protocol
  // text into the chat. `holder` carries the raw reply back out of the generator.
  async function* completing(prompt: string, holder: { reply: string; streamed: string }): AsyncGenerator<EngineerEvent> {
    holder.streamed = '';
    if (!deps.completeStream) {
      holder.reply = await deps.complete(prompt);
      return;
    }
    const streamer = new FinalAnswerStreamer();
    let raw = '';
    for await (const delta of deps.completeStream(prompt)) {
      raw += delta;
      const text = streamer.push(delta);
      if (text) yield { type: 'token', text };
    }
    holder.reply = raw;
    holder.streamed = streamer.text;
  }

  const held = { reply: '', streamed: '' };
  let lastStreamed = '';
  for (let n = 1; n <= maxSteps; n++) {
    // Reaching the top of the loop with streamed text behind us means a final
    // answer was shown and then REJECTED by a quality correction. Say so, rather
    // than letting a second answer silently appear under the first.
    if (lastStreamed) {
      yield { type: 'note', n, kind: 'replan', message: 'revising that answer' };
      lastStreamed = '';
    }
    yield* completing(transcript.join('\n\n'), held);
    let reply = held.reply;
    let streamedThisAttempt = held.streamed;
    lastStreamed = streamedThisAttempt;
    let step = parseStep(reply);
    if (step.kind === 'malformed') {
      transcript.push(`Your last reply was invalid (${step.reason}). Reply with ONLY the JSON protocol object.`);
      yield* completing(transcript.join('\n\n'), held);
      reply = held.reply;
      streamedThisAttempt = held.streamed;
      lastStreamed = streamedThisAttempt;
      step = parseStep(reply, { lenient: true });
      if (step.kind === 'malformed') {
        // Record a capped sample of what the model actually said. Without it a
        // protocol break is undiagnosable — the run just dies with "not valid
        // JSON" and no evidence of which shape the model emitted.
        stage.log('error', { code: 'MALFORMED_MODEL_OUTPUT', n, reply: cap(reply.trim(), 400) });
        // Very often the "malformed" reply IS the answer — the model wrote its
        // markdown directly instead of wrapping it in the protocol. After real
        // tool work, discarding that means throwing away a correct, cited answer
        // and showing a failure instead (observed: a 45s repo question died this
        // way). Accept substantial prose as the final rather than dead-ending.
        if (toolStepCount > 0 && looksLikeProseAnswer(reply)) {
          const salvaged = reply.trim() + (proposalsEmitted > 0 ? APPLIED_FOOTER : '');
          stage.log('final', { steps: toolStepCount, proposals: proposalsEmitted, salvaged: 'prose' });
          yield { type: 'final', markdown: salvaged, steps: toolStepCount };
          return;
        }
        // Work already recorded must not be thrown away because the model's NEXT
        // reply was unusable. Observed live: a build proposed all three files,
        // then broke protocol on the summary step — and the whole run surfaced as
        // "Engineer run failed" with the proposals stranded above it.
        if (proposalsEmitted > 0) {
          yield { type: 'final', markdown: salvagedFinal(proposalsEmitted, 'the model broke protocol on its summary step') + APPLIED_FOOTER, steps: toolStepCount };
          return;
        }
        yield { type: 'error', code: 'MALFORMED_MODEL_OUTPUT', message: `step ${n}: ${step.reason}` };
        return;
      }
    }

    if (step.kind === 'final') {
      // The weak-final check enforces a real COMPLETION REPORT — it only applies
      // once the agent has actually done work. This agent also answers ordinary
      // questions, where finishing on step 1 with a short direct answer is the
      // CORRECT behavior; demanding "which commands you ran" there would badger
      // the model into padding a plain answer with work it never did.
      // An EMPTY final is never acceptable on either path.
      const answeredDirectly = toolStepCount === 0;
      const weak = answeredDirectly ? step.markdown.trim().length === 0 : isWeakFinal(step.markdown);
      if (weak && !finalCorrected) {
        finalCorrected = true;
        transcript.push(answeredDirectly ? EMPTY_FINAL_DIRECTIVE : WEAK_FINAL_DIRECTIVE);
        continue; // exactly one corrective retry
      }
      // The inverse of the false-FAILURE case below: a claim that files were
      // created when NOTHING was produced.
      //
      // This keys on OUTPUT, not on whether a tool ran. Keying on "zero tools"
      // left a wide hole: handed a full Sprint-1 build order, the agent ran
      // git.status + file.readRange + workspace.search, proposed NOTHING, and
      // then reported "Generated apps/demo-forced-door … Created index.ts,
      // routes.ts … Ran npm install: Failed". Three read-only calls were enough
      // to skip the guard entirely. Reading files is not producing them.
      const producedNothing = proposalsEmitted === 0 && !filesCreatedByCommand;
      if (producedNothing && claimsPhantomWork(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(PHANTOM_WORK_DIRECTIVE);
        continue;
      }
      // Asserting what exists on disk without ever listing it.
      if (!executedTools.has('workspace.list') && CLAIMS_FILESYSTEM_CONTENTS.test(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(LIST_FIRST_DIRECTIVE);
        continue;
      }
      // Claiming a COMMAND result when no command ever executed.
      if (!executedTools.has('command.run') && claimsCommandResult(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(NO_COMMAND_DIRECTIVE);
        continue;
      }
      // Claiming the OUTCOME of a tool that never ran — "the workspace search did
      // not find…" after calling only diagnostics.get. Exactly checkable, since
      // the loop knows what it executed.
      const unrun = claimedUnrunTool(step.markdown, executedTools, deps.tools.map((t) => t.id));
      if (unrun && !finalCorrected) {
        finalCorrected = true;
        transcript.push(
          `You did NOT call ${unrun} in this turn, so you cannot report what it did or did not find. ` +
            `Either call ${unrun} now and answer from its real result, or write a final that makes no claim about it.`,
        );
        continue;
      }
      // Given real code, used none of it, and called no tools — a non-answer.
      // Checked by CITATION rather than wording: the loop knows what it seeded.
      if (answeredDirectly && ignoredSeededContext(step.markdown, input.context ?? []) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(
          'You were handed the code above and your answer cites none of it. Those excerpts are real ' +
            'source from this workspace: answer from them and cite `path:line`. If they genuinely do not ' +
            'cover the question, call workspace.search now instead of saying so — the excerpts are a ' +
            'SAMPLE of the repository, never proof that something is absent from it.',
        );
        continue;
      }
      // The opposite failure, same root cause: handing the work back to the user
      // — refusing, asking for context, or announcing an inspection never done —
      // while holding the tools that would have settled it.
      if (answeredDirectly && DEFERRED_TO_USER.test(step.markdown) && !finalCorrected) {
        finalCorrected = true;
        transcript.push(LOOK_FIRST_DIRECTIVE);
        continue;
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
      // …and the same for a phantom claim of work that survived its correction:
      // state the ground truth deterministically rather than let the prose stand.
      if (producedNothing && claimsPhantomWork(markdown)) {
        markdown += NO_WORK_FOOTER;
      }
      if (!executedTools.has('command.run') && claimsCommandResult(markdown)) {
        markdown += NO_COMMAND_FOOTER;
      }
      markdown = proposalsEmitted > 0 ? markdown + APPLIED_FOOTER : markdown;
      stage.log('final', { steps: toolStepCount, proposals: proposalsEmitted, replans });
      // The client has already rendered `streamedThisAttempt`. Tell it whether
      // that text is still a prefix of what we are sending, so it can append the
      // remainder instead of repeating the whole answer.
      const streamedPrefix = streamedThisAttempt.length > 0 && markdown.startsWith(streamedThisAttempt);
      yield { type: 'final', markdown, steps: toolStepCount, streamedPrefix };
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
          executedTools.add(tool);
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
                filesCreatedByCommand = true;
                progressed = true; // command side effect is progress
              }
            }
            // For a proposal, prefix an explicit SUCCESS signal — the raw result
            // object alone led models to mistake the preview-only outcome for a
            // failure and tell the user to create files manually.
            // Sanity-check a proposed changeset for OBVIOUS defects (duplicate
            // definitions, leaked tool-call markup, merge markers, broken JSON) and
            // feed them back so the model self-corrects BEFORE the botch reaches the
            // user's files. Bounded, so it can never loop.
            const lintOps =
              tool === 'fs.proposeChangeset'
                ? ((toolInput as { ops?: Array<{ op?: string; path?: string; content?: string | null }> }).ops ?? [])
                : [];
            const defects = lintOps.length ? lintChangeset(lintOps) : [];
            if (defects.length > 0 && lintCorrections < MAX_LINT_CORRECTIONS) {
              lintCorrections += 1;
              progressed = true; // a correction round is progress, not a stall
              yield { type: 'note', n, kind: 'quality', message: `proposed change looks broken — ${summarizeDefects(defects)}; asking the model to fix it` };
              transcript.push(
                `Your fs.proposeChangeset proposal has DEFECTS that would break the code: ${summarizeDefects(defects)}. Re-propose the COMPLETE, corrected file(s) with fs.proposeChangeset — replace the whole file content, remove any duplicated definitions or leaked markup, and make sure it parses. Do this now.`,
              );
            } else {
              transcript.push(
                isProposal
                  ? `Result of ${tool}: PROPOSAL RECORDED SUCCESSFULLY (preview-only; the operator approves and applies it, not you). This is the intended outcome — do NOT call it a failure and do NOT ask the user to create files manually. Propose any remaining files, then reply {"final":...} presenting the proposed file(s) as ready to apply.\n${cap(stableStringify(result), resultCap)}`
                  : `Result of ${tool}:\n${cap(stableStringify(result), resultCap)}\n\nContinue with the JSON protocol object.`,
              );
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            // `err.name` alone is always "Error" — useless. The first line carries
            // the actual code and reason ("INVALID_INPUT: …"), which is what makes
            // a failed build diagnosable at all. First line only, capped, so the
            // metadata-only logging contract still holds (no file content/diffs).
            stage.log('tool', {
              n,
              tool,
              durationMs: Date.now() - toolStarted,
              outcome: 'error',
              reason: message.split('\n')[0]!.slice(0, 200),
            });
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
