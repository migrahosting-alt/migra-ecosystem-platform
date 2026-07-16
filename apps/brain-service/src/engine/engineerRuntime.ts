// Engineer runtime — the model-in-the-loop workspace agent behind
// POST /api/ai/engineer (Slice 2: workspace-agent capability routing).
//
// This is deliberately a SEPARATE surface from the agent registry: registry
// agents have DETERMINISTIC fixed plans (replayable, delegable to pilot-api),
// while this loop is model-driven and local-only. It never touches the pilot
// runtime, so disabled remote delegation cannot affect ordinary local work.
//
// Protocol: the model must reply with ONE JSON object per step —
//   {"action": {"tool": "<id>", "input": {...}}}   execute a tool and continue
//   {"final": "<markdown answer>"}                 finish the task
// Malformed output gets exactly one corrective retry per step.
//
// Mutation policy (owner, 2026-07-16): the loop NEVER writes. `edit.apply` is
// auto-substituted with `edit.preview`, surfaced as a PROPOSAL event, and the
// final answer carries the proposed diffs. Applying remains an explicit,
// separately-approved act outside this loop. `command.run` is available under
// its own server-side allowlist policy (builds/tests — matrix default Enabled).

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
  maxSteps?: number;
  /** Cap for tool results fed back to the model (chars). */
  resultCap?: number;
}

export interface EngineerInput {
  rootPath: string;
  task: string;
  /** Attach the MigraTeck ecosystem context block (detected by the caller). */
  ecosystem?: boolean;
}

export type EngineerEvent =
  | { type: 'step'; n: number; tool: string; summary: string }
  | { type: 'proposal'; n: number; preview: unknown }
  | { type: 'final'; markdown: string; steps: number }
  | { type: 'error'; code: 'MALFORMED_MODEL_OUTPUT' | 'UNKNOWN_TOOL' | 'STEP_LIMIT' | 'TOOL_FAILED'; message: string };

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_RESULT_CAP = 6_000;

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
    '- To propose file changes use edit.preview; changes are applied by the operator',
    '  after approval, never by you. Put proposed diffs in your final answer.',
    '- Use command.run (argv array, e.g. ["npm","test"]) for builds/tests; only',
    '  allowlisted programs run.',
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

function summarize(input: unknown): string {
  const s = JSON.stringify(input);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

function cap(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…[truncated]` : text;
}

/** Run one engineering task as an event stream. Local-only by construction. */
export async function* runEngineerTask(deps: EngineerDeps, input: EngineerInput): AsyncGenerator<EngineerEvent> {
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const resultCap = deps.resultCap ?? DEFAULT_RESULT_CAP;
  const toolIds = new Set(deps.tools.map((t) => t.id));
  const transcript: string[] = [protocolPrompt(input, deps.tools)];

  for (let n = 1; n <= maxSteps; n++) {
    let reply = await deps.complete(transcript.join('\n\n'));
    let step = parseStep(reply);
    if (step.kind === 'malformed') {
      // Exactly one corrective retry per step.
      transcript.push(`Your last reply was invalid (${step.reason}). Reply with ONLY the JSON protocol object.`);
      reply = await deps.complete(transcript.join('\n\n'));
      step = parseStep(reply);
      if (step.kind === 'malformed') {
        yield { type: 'error', code: 'MALFORMED_MODEL_OUTPUT', message: `step ${n}: ${step.reason}` };
        return;
      }
    }

    if (step.kind === 'final') {
      yield { type: 'final', markdown: step.markdown, steps: n - 1 };
      return;
    }

    // Mutation policy: edit.apply is never executed by the loop — substitute
    // the read-only preview and surface it as a proposal.
    const isProposal = step.tool === 'edit.apply' || step.tool === 'edit.preview';
    const tool = step.tool === 'edit.apply' ? 'edit.preview' : step.tool;

    if (!toolIds.has(tool)) {
      transcript.push(`Tool "${step.tool}" does not exist. Available: ${[...toolIds].join(', ')}. Reply with the JSON protocol object.`);
      continue; // consumed a step; the cap still bounds the loop
    }

    // Server-authoritative root: whatever the model wrote, the task's root wins.
    const toolInput = { ...(step.input as Record<string, unknown> ?? {}), rootPath: input.rootPath };
    yield { type: 'step', n, tool, summary: summarize(toolInput) };
    try {
      const result = await deps.executeTool(tool, toolInput);
      if (isProposal) yield { type: 'proposal', n, preview: result };
      transcript.push(`Result of ${tool}:\n${cap(JSON.stringify(result), resultCap)}\n\nContinue with the JSON protocol object.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Tool failures are FEEDBACK, not fatal: the model may adapt (e.g. a
      // failing build is exactly what a debug task needs to see).
      transcript.push(`Tool ${tool} FAILED: ${cap(message, 500)}\n\nContinue with the JSON protocol object.`);
    }
  }
  yield { type: 'error', code: 'STEP_LIMIT', message: `stopped after ${maxSteps} steps without a final answer` };
}
