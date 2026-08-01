// `POST /api/ai/answer` — the agentic, tool-using answer path. The model gathers
// real workspace evidence with read-only tools before answering (Copilot-style),
// so codebase questions are grounded and cited rather than imagined. Read-only by
// construction; no approval token needed.
//
// `stream: true` streams Server-Sent Events (route → step* → token* → done) so a
// client can render live tool progress and a verified answer.
// `tier: 'cloud'` escalates to a faster/stronger cloud model. © MigraTeck LLC.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomUUID } from 'node:crypto';
import { agenticAnswer, streamAgentic } from './agenticAnswer.js';
import { describeTimings } from './answerTimings.js';

/**
 * The tier vocabulary of THIS route.
 *
 * Deliberately not the `/health` provider labels and not the model-registry tiers
 * (`fast`/`balanced`/`deep`): those describe a model's characteristics, this
 * describes where the answer runs. Two contracts that look alike are not one
 * contract, and renaming either to match the other would silently move callers
 * between them.
 */
export const ANSWER_TIERS = ['local', 'cloud'] as const;
export type AnswerTier = (typeof ANSWER_TIERS)[number];

/** Documented default when the caller omits `tier`. */
export const DEFAULT_ANSWER_TIER: AnswerTier = 'local';

interface AnswerBody {
  prompt?: string;
  workspaceRoot?: string;
  model?: string;
  tier?: unknown;
  maxSteps?: unknown;
  stream?: boolean;
}

export interface AnswerRouteOptions {
  providerBaseUrl: string;
  /** Tool-capable local model (default tier). */
  defaultModel: string;
  /** Faster/stronger model for `tier: 'cloud'` (opt-in). */
  cloudModel: string;
}

export interface AnswerValidationError {
  code: 'BAD_REQUEST' | 'workspace_not_open' | 'invalid_tier' | 'invalid_max_steps';
  field?: string;
  error: string;
  received?: unknown;
  allowed?: readonly string[];
}

export interface ValidatedAnswerRequest {
  prompt: string;
  workspaceRoot: string;
  tier: AnswerTier;
  /** Whether `tier` was supplied or defaulted — reported back, never inferred. */
  tierSource: 'explicit' | 'default';
  model?: string;
  maxSteps?: number;
  stream: boolean;
}

/**
 * Validate a request against the route's OWN vocabulary.
 *
 * The defect this closes: `tier: 'premium'` was accepted and quietly ran locally.
 * A caller asking for something the route does not offer got a plausible answer
 * from a runner it never chose, and nothing in the response said so. An unknown
 * tier is now a 400 with the allowed set, because silently substituting a
 * different runner is a worse failure than refusing the request.
 */
export function validateAnswerRequest(body: AnswerBody | undefined | null): { ok: true; value: ValidatedAnswerRequest } | { ok: false; error: AnswerValidationError } {
  const b = body ?? {};
  const prompt = (typeof b.prompt === 'string' ? b.prompt : '').trim();
  const workspaceRoot = (typeof b.workspaceRoot === 'string' ? b.workspaceRoot : '').trim();

  if (!prompt) {
    return { ok: false, error: { code: 'BAD_REQUEST', field: 'prompt', error: 'Provide a non-empty `prompt`.' } };
  }
  if (!workspaceRoot) {
    return { ok: false, error: { code: 'workspace_not_open', field: 'workspaceRoot', error: 'A `workspaceRoot` is required for a grounded answer.' } };
  }

  let tier: AnswerTier = DEFAULT_ANSWER_TIER;
  let tierSource: 'explicit' | 'default' = 'default';
  if (b.tier !== undefined && b.tier !== null) {
    if (typeof b.tier !== 'string' || !(ANSWER_TIERS as readonly string[]).includes(b.tier)) {
      return {
        ok: false,
        error: {
          code: 'invalid_tier',
          field: 'tier',
          error: `Unsupported \`tier\`. This route accepts ${ANSWER_TIERS.map((t) => `\`${t}\``).join(' or ')}; omit it for \`${DEFAULT_ANSWER_TIER}\`.`,
          received: b.tier,
          allowed: ANSWER_TIERS,
        },
      };
    }
    tier = b.tier as AnswerTier;
    tierSource = 'explicit';
  }

  let maxSteps: number | undefined;
  if (b.maxSteps !== undefined && b.maxSteps !== null) {
    const n = typeof b.maxSteps === 'number' ? b.maxSteps : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > 32) {
      return { ok: false, error: { code: 'invalid_max_steps', field: 'maxSteps', error: '`maxSteps` must be an integer between 1 and 32.', received: b.maxSteps } };
    }
    maxSteps = n;
  }

  const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : undefined;
  return { ok: true, value: { prompt, workspaceRoot, tier, tierSource, ...(model ? { model } : {}), ...(maxSteps ? { maxSteps } : {}), stream: b.stream === true } };
}

export interface ResolvedRunner {
  model: string;
  runner: 'local' | 'cloud';
  /** How the model was chosen, so the response can explain itself. */
  source: 'explicit-model' | 'tier' | 'default';
}

/**
 * Resolve the model AND the runner that will actually serve the request.
 *
 * `runner` is derived from the model finally chosen, not from what was asked for:
 * an explicit `model` overrides `tier`, and a response that still claimed
 * `runner: 'local'` while running a cloud model would be reporting the request
 * rather than the execution.
 */
export function resolveRunner(req: Pick<ValidatedAnswerRequest, 'tier' | 'model'>, opts: AnswerRouteOptions): ResolvedRunner {
  if (req.model) {
    const runner = req.model === opts.cloudModel || /-cloud$/i.test(req.model) ? 'cloud' : 'local';
    return { model: req.model, runner, source: 'explicit-model' };
  }
  if (req.tier === 'cloud') return { model: opts.cloudModel, runner: 'cloud', source: 'tier' };
  return { model: opts.defaultModel, runner: 'local', source: 'default' };
}

export function registerAnswerRoutes(app: FastifyInstance, opts: AnswerRouteOptions): void {
  app.post('/api/ai/answer', async (request: FastifyRequest<{ Body: AnswerBody }>, reply: FastifyReply) => {
    const traceId = String((request.headers['x-request-id'] as string | undefined) ?? '') || `ans_${randomUUID()}`;

    const parsed = validateAnswerRequest(request.body);
    if (!parsed.ok) {
      reply.code(400);
      return { ok: false, ...parsed.error, traceId };
    }
    const req = parsed.value;
    const resolved = resolveRunner(req, opts);
    const loopOpts = {
      prompt: req.prompt,
      workspaceRoot: req.workspaceRoot,
      model: resolved.model,
      runner: resolved.runner,
      providerBaseUrl: opts.providerBaseUrl,
      ...(req.maxSteps ? { maxSteps: req.maxSteps } : {}),
    };

    // ── SSE streaming path: live tool steps + a verified answer ──
    if (req.stream) {
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-request-id': traceId,
      });
      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };
      // Route-level facts the loop does not know about (trace, tier provenance).
      // Sent as its own event so it never competes with the loop's `route` event.
      send('request', { traceId, tier: req.tier, tierSource: req.tierSource, runner: resolved.runner, model: resolved.model });
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
      // Where the wall clock went, on one line, per run. A timing report that only
      // exists in a response body cannot be correlated after the fact.
      request.log.info(
        { traceId, runner: result.runner, refused: result.refused, rejected: result.rejected.length },
        `answer ${describeTimings(result.timings)}`,
      );
      // A budget exhaustion is reported as its own measured category — never
      // flattened into a generic failure, and never dressed up as a complete run.
      if (result.timeout && result.timeout.category !== 'client_abort') {
        reply.code(504);
        return {
          ok: false,
          code: result.timeout.category,
          error: `The run stopped at model call #${result.timeout.callIndex}, which used its ${result.timeout.callBudgetMs}ms budget.`,
          traceId,
          tier: req.tier,
          tierSource: req.tierSource,
          runner: result.runner,
          model: result.model,
          timeout: result.timeout,
          timings: result.timings,
          partialAnswer: result.answer,
          claims: result.claims,
          steps: result.steps,
        };
      }
      return {
        ok: true,
        traceId,
        tier: req.tier,
        tierSource: req.tierSource,
        // The runner that ACTUALLY served the request, resolved from the model.
        runner: result.runner,
        executionScope: result.runner,
        model: result.model,
        answer: result.answer,
        rawAnswer: result.rawAnswer,
        grounding: {
          refused: result.refused,
          claims: result.claims,
          rejected: result.rejected,
          directClaims: result.claims.filter((c) => c.kind === 'direct_evidence').length,
          inferenceClaims: result.claims.filter((c) => c.kind === 'inference').length,
        },
        timings: result.timings,
        steps: result.steps,
        stepsUsed: result.stepsUsed,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.code(502);
      return { ok: false, code: 'ANSWER_FAILED', error: message, traceId, tier: req.tier, runner: resolved.runner, model: resolved.model };
    }
  });
}
