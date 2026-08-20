// Structured test runs (`POST /api/ai/test-run`).
//
// Same boundary as the ad-hoc command lane, and for the same reason: this EXECUTES, so it is
// reached only when a person asks for it. `POST /api/ai/tools` still refuses `command.run`
// with 403, and `test.run` is deliberately absent from the generic tool registry too — the
// model's tool loop cannot start a test run on its own initiative.
//
// The executor, its allowlist and every one of its refusals are reused unchanged. What this
// route adds is the question ("run the project's tests") and the shape of the answer
// (pass / fail / timeout / refused, with parsed failures and bounded raw output).

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ToolErrorSchema } from '@migrapilot/protocol';
import { testRun } from '../tools/testRun.js';

/** Register `POST /api/ai/test-run`. */
export function registerTestRunRoutes(app: FastifyInstance): void {
  app.post('/api/ai/test-run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // A refusal is returned as a 200 with status: 'refused' — it is an ANSWER to the
      // question ("nothing safe to run here"), not a transport or server failure, and a
      // caller must be able to tell it from a suite that ran and failed.
      return await testRun(request.body as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      reply.code(400).send(ToolErrorSchema.parse({ code: 'INVALID_INPUT', message }));
      return reply;
    }
  });
}
