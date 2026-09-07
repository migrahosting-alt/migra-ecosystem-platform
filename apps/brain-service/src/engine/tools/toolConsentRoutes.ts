/**
 * THE APPROVAL ROUND-TRIP, over HTTP.
 *
 *   POST /api/ai/tools/propose   → run every pre-consent gate, return the exact
 *                                  normalized action text and an opaque token
 *   POST /api/ai/tools/decline   → reject the token; no side effect, ever
 *   POST /api/ai/tools/dispatch  → RE-CHECK every gate against current state,
 *                                  consume the token, then execute exactly once
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE TOKEN IS NOT DELEGATED AUTHORITY
 *
 * The regression this surface exists to prevent is: propose → approve → the
 * user's access is revoked → dispatch. A token that carried authority would let
 * the rename through, because it was minted while the user still had access.
 *
 * So `dispatch` re-resolves the registry, the connection, and the CURRENT
 * authorization before it will run anything. The approval says "this exact
 * action was consented to", never "this caller may act". Those are different
 * claims and only one of them is a token's to make.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT IS TOLD, AND WHAT IT IS NOT
 *
 * Responses carry the user-facing sentence and nothing else from the machinery:
 * no input hashes, no tool ids, no backend codes, no store vocabulary. A caller
 * needs to know what happened and what to do; `NOT_APPROVED`, `sha256:…` and
 * `CONSUMED` tell it neither, and put internals on a screen.
 * ---------------------------------------------------------------------------
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { ConversationStore, Scope } from '../memory/conversationStore.js';
import { approveAndPrepare, decline, propose } from './consentRoundTrip.js';
import {
  executeRename,
  normalizeRename,
  preflightRename,
  type RenameConversationInput,
} from './renameConversationTool.js';
import type { ToolApprovalStore } from './toolApprovalStore.js';
import type {
  AuthorizationFact,
  CapabilityState,
  RouterResolvers,
} from './toolRouter.js';

/** The one tool exposed so far. Named here, not accepted from the request. */
const RENAME = 'conversations.rename';

export interface ConsentRouteDeps {
  approvals: ToolApprovalStore;
  conversations: ConversationStore;
  /**
   * Resolved per request, from the product's auth context.
   *
   * Injected rather than read here so the route cannot become a second opinion
   * on who may do what — and so a test can revoke access between two calls,
   * which is the regression that matters most.
   */
  authorize(request: FastifyRequest, toolId: string, scope: Scope): Promise<AuthorizationFact> | AuthorizationFact;
  /** Registry state for the capability. Injected for the same reason. */
  capabilityState?(toolId: string): Promise<CapabilityState> | CapabilityState;
  scopeFrom(request: FastifyRequest): Scope;
}

/**
 * Everything the client may see.
 *
 * `approvalToken` is the store's id and is opaque BY USE, not by encoding: the
 * client passes it back and never parses it. Nothing else internal appears.
 */
interface ProposeResponse {
  status: 'needs_approval' | 'ready' | 'blocked';
  /** The exact normalized mutation, in the user's words. */
  action?: string;
  approvalToken?: string;
  /** Present when blocked. Always a sentence, never a code. */
  message?: string;
  /** What the client should offer instead: connect, request-access, retry-later. */
  suggestedAction?: string;
}

export function registerToolConsentRoutes(app: FastifyInstance, deps: ConsentRouteDeps): void {
  const resolversFor = (request: FastifyRequest, scope: Scope): Omit<RouterResolvers<RenameConversationInput>, 'consent'> => ({
    capabilityState: () => deps.capabilityState?.(RENAME) ?? 'available',
    connectionState: () => ({ state: 'not_required' }),
    authorization: () => deps.authorize(request, RENAME, scope),
    normalize: normalizeRename,
    preflight: (input) =>
      preflightRename(input, {
        getConversation: (id, s) => deps.conversations.getConversation(id, s),
        scope,
      }),
  });

  const roundTripDeps = (request: FastifyRequest, scope: Scope) => ({
    approvals: deps.approvals,
    resolvers: resolversFor(request, scope),
    previewOf: (normalized: RenameConversationInput): string => {
      const current = deps.conversations.getConversation(normalized.conversationId, scope);
      return `Rename this conversation from “${current?.title ?? ''}” to “${normalized.title}”`;
    },
  });

  /** Step 1 — propose. Nothing is mutated, and nothing can be from here. */
  app.post<{ Body: { conversationId?: string; title?: string } }>(
    '/api/ai/tools/conversations/rename/propose',
    async (request, reply): Promise<ProposeResponse> => {
      const { conversationId, title } = request.body ?? {};
      if (!conversationId || typeof title !== 'string') {
        reply.code(400);
        return { status: 'blocked', message: 'A conversation and a new title are required.' };
      }
      const scope = deps.scopeFrom(request);
      const result = await propose(
        { toolId: RENAME, input: { conversationId, title } },
        roundTripDeps(request, scope),
      );

      if (result.kind === 'blocked') {
        // 200, not 4xx: the request was well-formed and the answer is a refusal
        // the user can read. A status code is not the place for policy detail.
        return {
          status: 'blocked',
          message: result.message ?? 'This rename cannot run.',
          ...(result.routed.decision.action ? { suggestedAction: result.routed.decision.action } : {}),
        };
      }
      if (result.kind === 'executable_without_approval') {
        // Not reachable for a mutating tool; if the manifest ever changes, say so
        // rather than silently dispatching something nobody approved.
        return { status: 'ready', action: result.preview };
      }
      return { status: 'needs_approval', action: result.preview!, approvalToken: result.approvalId! };
    },
  );

  /** Step 2a — decline. The token is rejected and nothing is attempted. */
  app.post<{ Body: { approvalToken?: string; conversationId?: string; title?: string } }>(
    '/api/ai/tools/conversations/rename/decline',
    async (request, reply) => {
      const { approvalToken, conversationId, title } = request.body ?? {};
      if (!approvalToken || !conversationId || typeof title !== 'string') {
        reply.code(400);
        return { status: 'blocked', message: 'A pending approval is required.' };
      }
      const scope = deps.scopeFrom(request);
      decline(
        approvalToken,
        { toolId: RENAME, input: { conversationId, title } },
        normalizeRename({ conversationId, title }),
        { approvals: deps.approvals },
      );
      void scope;
      return { status: 'declined', message: 'Nothing was changed.' };
    },
  );

  /**
   * Step 2b — dispatch.
   *
   * Re-resolves EVERY gate against current state before consuming anything. The
   * approval authorises one exact action; it does not authorise the caller.
   */
  app.post<{ Body: { approvalToken?: string; conversationId?: string; title?: string } }>(
    '/api/ai/tools/conversations/rename/dispatch',
    async (request, reply) => {
      const { approvalToken, conversationId, title } = request.body ?? {};
      if (!approvalToken || !conversationId || typeof title !== 'string') {
        reply.code(400);
        return { status: 'blocked', message: 'A pending approval is required.' };
      }
      const scope = deps.scopeFrom(request);

      /*
       * 🚨 A THROW MUST NOT BECOME A 500 HERE.
       *
       * Measured: breaking the conversation read made this route return 500,
       * because the exception escaped the handler. A 500 reads as "server
       * error, safe to retry" — which is precisely the ambiguity this whole
       * surface exists to remove, and the one place a retry can duplicate a
       * side effect.
       *
       * The two phases are caught SEPARATELY because they mean different
       * things. A throw while preparing happens BEFORE any dispatch, so nothing
       * ran — the token is spent and the answer is a clean failure. A throw
       * around execution may or may not have landed, and that is unknown.
       */
      let attempt;
      try {
        attempt = await approveAndPrepare(
          approvalToken,
          { toolId: RENAME, input: { conversationId, title } },
          roundTripDeps(request, scope),
        );
      } catch {
        // Nothing was dispatched: the failure is in the gates, not the write.
        return { status: 'failed', message: 'The rename could not be prepared. Please try again.' };
      }

      if (attempt.refusal || !attempt.routed) {
        return {
          status: 'blocked',
          message: attempt.refusal?.message ?? 'This rename cannot run.',
          ...(attempt.routed?.decision.action ? { suggestedAction: attempt.routed.decision.action } : {}),
        };
      }

      let result;
      try {
        result = await executeRename(attempt.routed, {
          getConversation: (id, s) => deps.conversations.getConversation(id, s),
          renameConversation: (id, s, t) => deps.conversations.renameConversation(id, s, t),
          scope,
        });
      } catch {
        /*
         * executeRename handles its own errors, so reaching here means something
         * failed around the dispatch itself. We consumed the approval and cannot
         * say whether the write landed. That is the unknown state, not a 500.
         */
        reply.code(202);
        return {
          status: 'unknown',
          message: 'The rename was sent but could not be confirmed. Check the conversation before trying again.',
        };
      }

      if (result.outcome === 'success') {
        return {
          status: 'done',
          conversation: result.conversation,
          message: `Renamed to “${result.conversation!.title}”.`,
        };
      }
      if (result.outcome === 'outcome_unknown_after_dispatch') {
        /*
         * 🚨 ITS OWN STATE, AND ITS OWN STATUS CODE. Not 200 (which reads as
         * done) and not 500 (which reads as safe to retry). 202 says the request
         * was accepted and the result is not settled — and the message tells the
         * user to CHECK, never to try again.
         */
        reply.code(202);
        return { status: 'unknown', message: result.message };
      }
      return { status: 'failed', message: result.message ?? 'The rename did not go through.' };
    },
  );
}
