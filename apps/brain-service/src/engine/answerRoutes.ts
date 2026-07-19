// `POST /api/ai/answer` — the agentic, tool-using answer path. The model gathers
// real workspace evidence with read-only tools before answering (Copilot-style),
// so codebase questions are grounded and cited rather than imagined. Read-only by
// construction; no approval token needed.
//
// `stream: true` streams Server-Sent Events (route → step* → token* → done) so a
// client can render live tool progress and a token-by-token answer.
// `tier: 'cloud'` escalates to a faster/stronger cloud model. © MigraTeck LLC.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { agenticAnswer, streamAgentic } from './agenticAnswer.js';

interface AnswerBody {
  prompt?: string;
  workspaceRoot?: string;
  model?: string;
  tier?: 'local' | 'cloud';
  maxSteps?: number;
  stream?: boolean;
}

export interface AnswerRouteOptions {
  providerBaseUrl: string;
  /** Tool-capable local model (default tier). */
  defaultModel: string;
  /** Faster/stronger model for `tier: 'cloud'` (opt-in). */
  cloudModel: string;
}

function resolveModel(body: AnswerBody, opts: AnswerRouteOptions): string {
  if (body.model && body.model.trim()) return body.model.trim();
  if (body.tier === 'cloud') return opts.cloudModel;
  return opts.defaultModel;
}

export function registerAnswerRoutes(app: FastifyInstance, opts: AnswerRouteOptions): void {
  app.post('/api/ai/answer', async (request: FastifyRequest<{ Body: AnswerBody }>, reply: FastifyReply) => {
    const traceId = String((request.headers['x-request-id'] as string | undefined) ?? '') || `ans_${randomUUID()}`;
    const body = request.body ?? {};
    const prompt = (body.prompt ?? '').trim();
    const workspaceRoot = (body.workspaceRoot ?? '').trim();

    if (!prompt) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'Provide a non-empty `prompt`.', traceId };
    }
    if (!workspaceRoot) {
      reply.code(400);
      return { ok: false, code: 'workspace_not_open', error: 'A `workspaceRoot` is required for a grounded answer.', traceId };
    }

    const model = resolveModel(body, opts);
    const loopOpts = { prompt, workspaceRoot, model, providerBaseUrl: opts.providerBaseUrl, maxSteps: body.maxSteps };

    // ── SSE streaming path: live tool steps + token-by-token answer ──
    if (body.stream) {
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-request-id': traceId,
      });
      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      const ac = new AbortController();
      request.raw.on('close', () => ac.abort());
      try {
        for await (const ev of streamAgentic({ ...loopOpts, signal: ac.signal })) {
          send(ev.type, ev);
        }
      } catch (err) {
        send('error', { message: err instanceof Error ? err.message : String(err), traceId });
      } finally {
        reply.raw.end();
      }
      return reply;
    }

    // ── JSON path (non-streaming) ──
    try {
      const result = await agenticAnswer(loopOpts);
      return {
        ok: true,
        traceId,
        runner: 'local' as const,
        executionScope: 'local' as const,
        model: result.model,
        answer: result.answer,
        steps: result.steps,
        stepsUsed: result.stepsUsed,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502);
      return { ok: false, code: 'ANSWER_FAILED', error: message, traceId, runner: 'local' as const };
    }
  });
}
