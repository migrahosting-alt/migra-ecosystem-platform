// Ad-hoc command execution (`POST /api/ai/command-run`).
//
// WHY THIS ROUTE EXISTS SEPARATELY FROM AGENT MODE
// ------------------------------------------------
// The difference is AUTHORITY, not plumbing:
//
//   Ad-hoc command lane (this route)   Agent Mode recipe boundary
//   --------------------------------   ------------------------------------------
//   ONE bounded command                multi-step governed recipe
//   user-initiated, per invocation     autonomous, with checkpoint semantics
//   no autonomous follow-up            broader coordinated workflow across stages
//   no file-mutation authority         approval / checkpoint state machine
//     beyond what the allowed
//     command itself legitimately does
//
// `POST /api/ai/tools` still refuses `command.run` with 403, and that refusal stays
// load-bearing: it stops the MODEL's tool loop (executeToolCore -> agentRuntime) from
// running commands on its own initiative. This route is reached only when a person
// invokes it from the editor. A user pressing "Run Command" and a model deciding to
// run one are different things, and the boundary between them is this route's whole
// justification.
//
// NO SECOND EXECUTOR. Every control lives in `tools/commandRun.ts` and is reused
// unchanged: the allowlist (node/npm/npx/tsc/tsx unless MIGRAPILOT_COMMAND_ALLOWLIST
// overrides), bare-argv[0], `shell: false`, cwd containment by realpath, refusal of
// publish/deploy/release/push, refusal of executable-substituting environment keys,
// timeout, 24 KiB output caps, and redaction before the output leaves the tool.
//
// Interactive commands are refused STRUCTURALLY rather than by a name list: stdin is
// `'ignore'`, so anything waiting for input reads EOF and terminates instead of
// hanging a request open. A denylist of "interactive programs" would be a guess; a
// closed stdin is a property.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ToolErrorSchema } from '@migrapilot/protocol';
import { CommandPolicyError, commandRun } from '../tools/commandRun.js';

/**
 * A POLICY REFUSAL is not an internal error.
 *
 * `UNSUPPORTED` carries the refusal reason verbatim, so an operator sees "command
 * \"git\" is not on the allowlist" or "cwd escapes the workspace root" — the reason is
 * the useful part, and collapsing it into INTERNAL_ERROR would throw it away.
 */
function sendCommandError(reply: FastifyReply, error: unknown): void {
  if (error instanceof CommandPolicyError) {
    reply.code(400).send(ToolErrorSchema.parse({ code: 'UNSUPPORTED', message: error.message }));
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  reply.code(400).send(ToolErrorSchema.parse({ code: 'INTERNAL_ERROR', message }));
}

/** Register `POST /api/ai/command-run`. Single bounded command, policy enforced by commandRun. */
export function registerCommandRunRoutes(app: FastifyInstance): void {
  app.post('/api/ai/command-run', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Schema validation, allowlist, containment and caps all happen inside
      // commandRun(). Nothing is pre-validated here, so there is exactly one place
      // where command policy is decided.
      return await commandRun(request.body as never);
    } catch (error) {
      sendCommandError(reply, error);
      return reply;
    }
  });
}
