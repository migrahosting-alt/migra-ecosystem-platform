// POST /api/ai/engineer — SSE surface for the model-in-the-loop workspace
// engineer (Slice 2). Local-only: no pilot-api involvement anywhere on this
// path, so disabled remote delegation can never block ordinary local work.

import type { FastifyInstance } from 'fastify';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';
import { z } from 'zod';
import type { BrainEnv } from '../config/env.js';
import type { ModelRegistry, ModelDescriptor } from './modelRegistry.js';
import { selectModel, tierFromHints } from './capabilityRouter.js';
import { StubProvider, type ProviderAdapter } from '../providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../providers/openAiCompatProvider.js';
import { executeToolCore, type ToolExecDeps } from './toolExecutor.js';
import { newCorrelationId, makeStageLogger, jsonLineSink, type StageLogger } from './correlation.js';
import { runEngineerTask, type EngineerToolInfo } from './engineerRuntime.js';
import { changesetProposals } from './capabilityRegistry.js';
import { telemetryHub } from './telemetryHub.js';

const EngineerBodySchema = z.object({
  rootPath: z.string().min(1),
  task: z.string().min(1),
  ecosystem: z.boolean().optional(),
  tier: z.string().optional(),
});

/** One-line input hints shown to the model per tool (kept beside the route so
 * the protocol prompt stays in sync with what this deployment exposes). */
const INPUT_HINTS: Record<string, string> = {
  'workspace.search': '{"rootPath","query"}',
  'file.readRange': '{"rootPath","path","startLine","endLine"}',
  'file.readSymbol': '{"rootPath","path","symbol"}',
  'git.status': '{"rootPath"}',
  'git.diff': '{"rootPath"}',
  'diagnostics.get': '{"rootPath","path"?}',
  'edit.preview': '{"rootPath","changes":[{"path","startLine","endLine","replacement"}]}',
  'fs.proposeChangeset': '{"rootPath","ops":[{"op":"create","path":"src/x.js","content":"..."}]} (op: create|replace|patch|delete|mkdir)',
  'command.run': '{"rootPath","command":["npm","test"],"cwd"?,"timeoutMs"?}',
};

/** Shallow-ish workspace file listing for command side-effect detection. Skips
 * heavy/noisy dirs; bounded so a big install cannot flood the diff. */
async function listWorkspaceFiles(root: string, limit = 5_000): Promise<string[]> {
  const skip = new Set(['.git', 'node_modules', '.next', 'dist', '.cache']);
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (out.length >= limit || depth > 6) return;
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.isDirectory()) {
        if (!skip.has(e.name)) await walk(path.join(dir, e.name), depth + 1);
      } else {
        out.push(path.relative(root, path.join(dir, e.name)));
      }
    }
  }
  await walk(root, 0);
  return out;
}

export function registerEngineerRoutes(
  app: FastifyInstance,
  env: BrainEnv,
  modelRegistry: ModelRegistry,
  toolDeps: ToolExecDeps,
  providerOverride?: (model: ModelDescriptor) => ProviderAdapter,
): void {
  const real = env.localProvider === 'openai-compat';
  const providerFor = (model: ModelDescriptor): ProviderAdapter => {
    if (providerOverride) return providerOverride(model);
    if (!real) return new StubProvider('default');
    return new OpenAiCompatProvider({
      profile: 'default',
      baseUrl: env.providerBaseUrl,
      model: model.id,
      apiKey: env.openAiApiKey,
    });
  };

  /** The loop's tool surface: read-only capabilities + the two policy-gated
   * extras (edit.preview for proposals, command.run under its allowlist).
   * edit.apply is deliberately ABSENT — the loop never mutates. */
  const loopTools = (): EngineerToolInfo[] =>
    toolDeps.registry
      .list({ includeUnavailable: false })
      .filter((t) => t.kind === 'tool' && t.id !== 'edit.apply' && (t.readOnly || t.id === 'command.run'))
      .map((t) => ({
        id: t.id,
        description: t.description,
        readOnly: t.readOnly,
        inputHint: INPUT_HINTS[t.id] ?? '{"rootPath",...}',
      }));

  // Read-only store health/telemetry (Slice 2). Aggregate health + counters +
  // eviction stats + a small recent-events window — NO proposal bodies, approval
  // tokens, raw paths, or request data. Local, non-production.
  app.get('/api/ai/engineer/stores/health', async () => {
    const proposal = changesetProposals.health();
    const approval = toolDeps.approvals.health();
    const overall: 'healthy' | 'degraded' | 'unhealthy' =
      proposal.status === 'unhealthy' || approval.status === 'unhealthy'
        ? 'unhealthy'
        : proposal.status === 'degraded' || approval.status === 'degraded'
          ? 'degraded'
          : 'healthy';
    return {
      status: overall,
      stores: { proposal, approval },
      evictions: telemetryHub.evictionStats(),
      recent: telemetryHub.recentEvents(50).map((e) => ({ event: e.event, at: e.at, correlationId: e.correlationId, ...e.fields })),
    };
  });

  app.post('/api/ai/engineer', async (request, reply) => {
    const parsed = EngineerBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        ok: false,
        code: 'INVALID_INPUT',
        error: 'Engineer input failed schema validation.',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      };
    }
    const body = parsed.data;

    // Correlation id for the WHOLE execution (accept a caller-supplied id via
    // header for cross-service tracing, else mint one). Emits one structured
    // line per stage: request → route → loop-step → tool/proposal → apply → …
    const headerId = String((request.headers['x-correlation-id'] as string | undefined) ?? '').trim();
    const correlationId = headerId || newCorrelationId();
    const stage: StageLogger = makeStageLogger(correlationId, jsonLineSink((line) => request.log.info(line)));
    stage.log('request', { rootPath: body.rootPath, ecosystem: Boolean(body.ecosystem) });

    const decision = await selectModel(modelRegistry, {
      preferCoding: true,
      tier: tierFromHints({ tier: body.tier }),
    });
    if (!decision) {
      stage.log('error', { code: 'NO_MODEL' });
      reply.code(503);
      return { ok: false, code: 'NO_MODEL', error: 'No model available for the engineer loop.' };
    }
    const provider = providerFor(decision.model);
    stage.log('route', { model: decision.model.id, provider: decision.model.provider });

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let closed = false;
    request.raw.on('close', () => {
      closed = true;
    });
    const send = (event: string, data: unknown): void => {
      if (closed) return;
      try {
        raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };

    // Surface the correlation id to the client so it can be quoted in support.
    send('route', { model: decision.model.id, provider: decision.model.provider, reason: decision.reason, correlationId });

    const events = runEngineerTask(
      {
        complete: async (prompt) => {
          const res = await provider.complete({
            feature: 'chat',
            modelProfile: 'default',
            systemPromptId: 'engineer-v1',
            userPrompt: prompt,
            outputMode: 'markdown',
            context: {},
          });
          return res.content;
        },
        executeTool: async (tool, input) => {
          // Thread the same correlation logger into the tool boundary so
          // proposal/approval/apply stages share this execution's id.
          const outcome = await executeToolCore(toolDeps, { tool, input, requestId: `eng-${Date.now().toString(36)}`, stage });
          if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.error}`);
          // The loop never holds approvals — if a tool unexpectedly parks, that
          // is explicit feedback to the model, never a silent null result.
          if (outcome.status === 'approval_required') {
            throw new Error('APPROVAL_REQUIRED: this tool needs operator approval and cannot run inside the loop.');
          }
          return outcome.result ?? outcome.preview;
        },
        listFiles: async (root) => listWorkspaceFiles(root),
        stage,
        tools: loopTools(),
      },
      { rootPath: body.rootPath, task: body.task, ecosystem: body.ecosystem },
    );

    try {
      for await (const ev of events) {
        if (closed) break; // client went away — stop driving the model
        send(ev.type, ev);
      }
    } catch (err) {
      send('error', { type: 'error', code: 'ENGINE_FAILURE', message: err instanceof Error ? err.message : String(err) });
    }
    send('done', {});
    raw.end();
  });
}
