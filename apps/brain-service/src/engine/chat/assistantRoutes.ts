import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { redactSecrets } from '../memory/redaction.js';

export type AssistantCompletion = { reply: string; model?: string };

export interface AssistantDependencies {
  secret?: string;
  generate: (message: string, signal?: AbortSignal) => Promise<AssistantCompletion>;
}

const SYSTEM_PROMPT = [
  'You are MigraPilot, the AI assistant embedded in AnnouPale.',
  'You provide concise text suggestions and explanations only.',
  'You have no tools, executor, files, account access or ability to take actions.',
  'Never claim to post, send, follow, delete, change settings or perform an action.',
  'Never reveal credentials, private infrastructure or internal model details.',
  'Respect the language and writing instructions in the AnnouPale request.',
].join('\n');

function authorized(request: FastifyRequest, secret: string | undefined): boolean {
  const configured = secret?.trim();
  const header = request.headers.authorization;
  const provided = typeof header === 'string' ? /^Bearer\s+(\S+)$/i.exec(header)?.[1] : undefined;
  if (!configured || !provided || request.headers['x-caller'] !== 'annoupale-api') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(configured), digest(provided));
}

export function registerAssistantRoutes(app: FastifyInstance, dependencies: AssistantDependencies): void {
  app.post<{ Body: { message: string } }>('/api/pilot/assistant', {
    bodyLimit: 20_000,
    onRequest: async (request, reply) => {
      if (!authorized(request, dependencies.secret)) {
        return reply.code(401).send({ error: 'unauthorized' });
      }
    },
    preValidation: async (request, reply) => {
      const body = request.body;
      // Fastify's default validator coerces primitives and removes extra fields.
      if (!body || typeof body !== 'object' || Array.isArray(body) ||
          Object.keys(body).length !== 1 || typeof body.message !== 'string') {
        return reply.code(400).send({ error: 'invalid_assistant_request' });
      }
    },
    schema: {
      body: {
        type: 'object',
        additionalProperties: false,
        required: ['message'],
        properties: { message: { type: 'string', minLength: 1, maxLength: 12_000 } },
      },
    },
    errorHandler: (error, request, reply) => {
      if (error.validation || error.statusCode === 400 || error.statusCode === 413) {
        return reply.code(error.statusCode === 413 ? 413 : 400).send({ error: 'invalid_assistant_request' });
      }
      request.log.error({ reason: error.name }, 'safe-read assistant request failed');
      return reply.code(503).send({ error: 'assistant_unavailable', mode: 'assistant_safe_read' });
    },
  }, async (request, reply) => {
    const message = request.body.message.trim();
    if (!message) return reply.code(400).send({ error: 'invalid_assistant_request' });

    let completion: AssistantCompletion;
    const controller = new AbortController();
    const abort = () => controller.abort();
    const deadline = setTimeout(() => controller.abort(new DOMException('Assistant deadline exceeded', 'TimeoutError')), 20_000);
    reply.raw.once('close', abort);
    try {
      completion = await dependencies.generate(`${SYSTEM_PROMPT}\n\n${message}`, controller.signal);
    } catch (error) {
      request.log.warn({ reason: error instanceof Error ? error.name : 'unknown' }, 'safe-read assistant completion unavailable');
      return reply.code(503).send({ error: 'assistant_unavailable', mode: 'assistant_safe_read' });
    } finally {
      clearTimeout(deadline);
      reply.raw.off('close', abort);
    }
    if (typeof completion.reply !== 'string' || !completion.reply.trim()) {
      request.log.warn('safe-read assistant returned an empty or invalid completion');
      return reply.code(503).send({ error: 'assistant_unavailable', mode: 'assistant_safe_read' });
    }

    return {
      reply: redactSecrets(completion.reply).text.trim(),
      mode: 'assistant_safe_read',
      assistantName: 'MigraPilot',
      embeddedPlatform: 'AnnouPale',
      toolsExecuted: false,
      approvalCardsEmitted: false,
      executor: 'absent',
      ...(completion.model ? { model: completion.model } : {}),
    };
  });
}
