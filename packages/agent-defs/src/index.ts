/**
 * MigraAI Engine — Agent Registry.
 *
 * Agents are `kind: 'agent'` capabilities: bounded orchestrations the engine runs
 * on a client's behalf. The catalog is deliberately small and conservative — two
 * read-only agents and two approval-required proposed-edit agents. No unrestricted
 * autonomous coding or terminal execution.
 *
 * Each agent's `plan()` is DETERMINISTIC given its input + tool outputs, so runs
 * are reproducible in tests. A read-only agent returns a `result`; a mutating
 * agent returns a single proposed `action` (a tool call) that the run parks on for
 * approval. The plan output is computed once and frozen into the run — replanning
 * never alters an already-approved action.
 */

import { z, type ZodType } from 'zod';

export type AgentRuntimeKind = 'local' | 'pilot';

export interface AgentDescriptor {
  kind: 'agent';
  id: string;
  version: string;
  displayName: string;
  purpose: string;
  operationClasses: string[];
  requiredModelCapabilities: string[];
  requiredToolCapabilities: string[];
  readOnly: boolean;
  approvalRequired: boolean;
  resumable: boolean;
  cancellable: boolean;
  maxSteps: number;
  maxRuntimeMs: number;
  available: boolean;
  reason?: string;
}

export interface AgentContext {
  /** Execute a tool through the shared tool boundary (validated + audited). */
  callTool<T = unknown>(tool: string, input: unknown): Promise<T>;
}

export type PlanOutcome =
  | { kind: 'result'; result: unknown }
  | { kind: 'action'; tool: string; input: unknown; summary: string };

export interface AgentDefinition {
  descriptor: AgentDescriptor;
  runtime: AgentRuntimeKind;
  inputSchema: ZodType;
  plan(input: unknown, ctx: AgentContext): Promise<PlanOutcome>;
}

const RunTargetSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().min(1),
});

function descriptor(partial: Partial<AgentDescriptor> & Pick<AgentDescriptor, 'id' | 'displayName' | 'purpose'>): AgentDescriptor {
  return {
    kind: 'agent',
    version: '1',
    operationClasses: [],
    requiredModelCapabilities: [],
    requiredToolCapabilities: [],
    readOnly: true,
    approvalRequired: false,
    resumable: false,
    cancellable: true,
    maxSteps: 8,
    maxRuntimeMs: 60_000,
    available: true,
    ...partial,
  };
}

const AGENTS: AgentDefinition[] = [
  {
    descriptor: descriptor({
      id: 'workspace.explain',
      displayName: 'Explain Code',
      purpose: 'Explain a file or selection using workspace context.',
      operationClasses: ['read'],
      requiredModelCapabilities: ['chat'],
      requiredToolCapabilities: ['file.readRange', 'diagnostics.get'],
      readOnly: true,
    }),
    runtime: 'local',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      const range = await ctx.callTool('file.readRange', { rootPath, path, startLine: 1, endLine: 40 });
      return { kind: 'result', result: { summary: `Explained ${path} using workspace context.`, source: range } };
    },
  },
  {
    descriptor: descriptor({
      id: 'workspace.diagnostics',
      displayName: 'Summarize Diagnostics',
      purpose: 'Summarize current editor diagnostics for a file.',
      operationClasses: ['read'],
      requiredToolCapabilities: ['diagnostics.get'],
      readOnly: true,
    }),
    runtime: 'local',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      const diags = (await ctx.callTool('diagnostics.get', { rootPath, path })) as { items?: unknown[] };
      return { kind: 'result', result: { count: diags.items?.length ?? 0, items: diags.items ?? [] } };
    },
  },
  {
    descriptor: descriptor({
      id: 'workspace.test-generator',
      displayName: 'Generate Tests',
      purpose: 'Propose a test stub for a file (requires approval to apply).',
      operationClasses: ['propose-edit'],
      requiredModelCapabilities: ['chat', 'coding'],
      requiredToolCapabilities: ['file.readRange', 'edit.apply'],
      readOnly: false,
      approvalRequired: true,
      resumable: true,
      maxSteps: 12,
    }),
    runtime: 'local',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      // Gather (read-only) to justify the proposal, then propose a deterministic edit.
      await ctx.callTool('file.readRange', { rootPath, path, startLine: 1, endLine: 1 });
      return {
        kind: 'action',
        tool: 'edit.apply',
        input: { rootPath, changes: [{ path, startLine: 1, endLine: 1, replacement: '// migraai-test-generator' }] },
        summary: `Add a generated test stub to ${path}`,
      };
    },
  },
  {
    descriptor: descriptor({
      id: 'workspace.fix-diagnostics',
      displayName: 'Fix Diagnostics',
      purpose: 'Propose a targeted fix for a diagnostic (requires approval to apply).',
      operationClasses: ['propose-edit'],
      requiredModelCapabilities: ['chat', 'coding'],
      requiredToolCapabilities: ['diagnostics.get', 'file.readRange', 'edit.apply'],
      readOnly: false,
      approvalRequired: true,
      resumable: true,
      maxSteps: 12,
    }),
    runtime: 'local',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      const diags = (await ctx.callTool('diagnostics.get', { rootPath, path })) as {
        items?: Array<{ range?: { startLine?: number } }>;
      };
      const line = diags.items?.[0]?.range?.startLine ?? 1;
      return {
        kind: 'action',
        tool: 'edit.apply',
        input: { rootPath, changes: [{ path, startLine: line, endLine: line, replacement: '// migraai-fix' }] },
        summary: `Apply a targeted fix to ${path}`,
      };
    },
  },
  // ── Delegated (pilot-api runtime) variants ──────────────────────────────────
  // Same canonical contract + plan as their local twins, but `runtime: 'pilot'` so
  // the brain DELEGATES them to pilot-api (which runs the SAME shared plan through
  // the shared workspace-tool boundary). Opt-in: with delegation off, they fail
  // closed; the local agents above are unaffected.
  {
    descriptor: descriptor({
      id: 'workspace.diagnostics.pilot',
      displayName: 'Summarize Diagnostics (delegated)',
      purpose: 'Summarize diagnostics, executed on the pilot-api delegated runtime.',
      operationClasses: ['read'],
      requiredToolCapabilities: ['diagnostics.get'],
      readOnly: true,
    }),
    runtime: 'pilot',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      const diags = (await ctx.callTool('diagnostics.get', { rootPath, path })) as { items?: unknown[] };
      return { kind: 'result', result: { count: diags.items?.length ?? 0, items: diags.items ?? [] } };
    },
  },
  {
    descriptor: descriptor({
      id: 'workspace.fix-diagnostics.pilot',
      displayName: 'Fix Diagnostics (delegated)',
      purpose: 'Propose a targeted fix, executed on the pilot-api delegated runtime.',
      operationClasses: ['propose-edit'],
      requiredModelCapabilities: ['chat', 'coding'],
      requiredToolCapabilities: ['diagnostics.get', 'edit.apply'],
      readOnly: false,
      approvalRequired: true,
      resumable: true,
      maxSteps: 12,
    }),
    runtime: 'pilot',
    inputSchema: RunTargetSchema,
    async plan(input, ctx) {
      const { rootPath, path } = input as z.infer<typeof RunTargetSchema>;
      const diags = (await ctx.callTool('diagnostics.get', { rootPath, path })) as { items?: Array<{ range?: { startLine?: number } }> };
      const line = diags.items?.[0]?.range?.startLine ?? 1;
      return {
        kind: 'action',
        tool: 'edit.apply',
        input: { rootPath, changes: [{ path, startLine: line, endLine: line, replacement: '// migraai-fix' }] },
        summary: `Apply a targeted fix to ${path}`,
      };
    },
  },
];

export interface AgentFilter {
  operationClass?: string;
  readOnly?: boolean;
}

export class AgentRegistry {
  private readonly byId = new Map<string, AgentDefinition>();

  constructor(extra: AgentDefinition[] = []) {
    for (const a of [...AGENTS, ...extra]) this.byId.set(a.descriptor.id, a);
  }

  list(filter: AgentFilter = {}): AgentDescriptor[] {
    const out: AgentDescriptor[] = [];
    for (const a of this.byId.values()) {
      const d = a.descriptor;
      if (filter.readOnly !== undefined && d.readOnly !== filter.readOnly) continue;
      if (filter.operationClass && !d.operationClasses.includes(filter.operationClass)) continue;
      out.push(d);
    }
    return out.sort((x, y) => x.id.localeCompare(y.id));
  }

  get(id: string): AgentDescriptor | undefined {
    return this.byId.get(id)?.descriptor;
  }

  definition(id: string): AgentDefinition | undefined {
    return this.byId.get(id);
  }

  /** True when the agent id is registered at exactly this version. */
  hasVersion(id: string, version: string): boolean {
    return this.byId.get(id)?.descriptor.version === version;
  }

  /** Validate input against the agent's schema WITHOUT the caller touching zod —
   * so a consumer (e.g. pilot-api) can reuse the exact same validation. */
  validate(id: string, input: unknown): { ok: true; data: unknown } | { ok: false; issues: Array<{ path: string; message: string }> } {
    const def = this.byId.get(id);
    if (!def) return { ok: false, issues: [{ path: '', message: `Unknown agent: ${id}` }] };
    const parsed = def.inputSchema.safeParse(input);
    if (parsed.success) return { ok: true, data: parsed.data };
    return { ok: false, issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  }
}
