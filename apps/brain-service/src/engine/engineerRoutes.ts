// POST /api/ai/engineer — SSE surface for the model-in-the-loop workspace
// engineer (Slice 2). Local-only: no pilot-api involvement anywhere on this
// path, so disabled remote delegation can never block ordinary local work.

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { BrainEnv } from '../config/env.js';
import type { ModelRegistry, ModelDescriptor } from './modelRegistry.js';
import { selectModel, tierFromHints } from './capabilityRouter.js';
import { StubProvider, type ProviderAdapter } from '../providers/providerRegistry.js';
import { OpenAiCompatProvider } from '../providers/openAiCompatProvider.js';
import { executeToolCore, type ToolExecDeps } from './toolExecutor.js';
import { runEngineerTask, type EngineerToolInfo } from './engineerRuntime.js';

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
  'command.run': '{"rootPath","command":["npm","test"],"cwd"?,"timeoutMs"?}',
};

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

    const decision = await selectModel(modelRegistry, {
      preferCoding: true,
      tier: tierFromHints({ tier: body.tier }),
    });
    if (!decision) {
      reply.code(503);
      return { ok: false, code: 'NO_MODEL', error: 'No model available for the engineer loop.' };
    }
    const provider = providerFor(decision.model);

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

    send('route', { model: decision.model.id, provider: decision.model.provider, reason: decision.reason });

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
          const outcome = await executeToolCore(toolDeps, { tool, input, requestId: `eng-${Date.now().toString(36)}` });
          if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.error}`);
          return outcome.result ?? outcome.preview;
        },
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
