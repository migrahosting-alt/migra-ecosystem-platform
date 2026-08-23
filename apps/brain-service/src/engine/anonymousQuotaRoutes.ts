/**
 * Anonymous quota and claim, over HTTP.
 *
 * TRUST BOUNDARY. The Brain is not reachable from a browser; the consumer
 * gateway is, and it derives every scope server-side from either a verified
 * MigraAuth session or a signed anonymous cookie. So the scope header arriving
 * here is already authority. What this file adds is the checks the Brain can
 * make on its own, so a malformed or mismatched pair is refused here too rather
 * than trusted because it came from a friend:
 *
 *   - an anonymous scope must be `anon:<sessionId>` and match the session id
 *   - a claim must be made AS the account, with the anonymous side named
 *
 * Every refusal is typed. "Exhausted" and "the database is down" are different
 * facts and lead to different UI, and collapsing them into one 500 is how a
 * visitor gets told to sign in because a disk was full.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { evaluateAnonymousQuota } from '@migrapilot/shared-types/anonymous-quota';
import { ANON_PREFIX, type AnonymousQuotaDeps } from './anonymousQuotaDeps.js';

const bad = (reply: { code: (n: number) => unknown }, status: number, code: string, error: string) => {
  reply.code(status);
  return { ok: false, code, error };
};

/** The anonymous owner scope, verified structurally rather than assumed. */
function anonymousScope(request: FastifyRequest): { sessionId: string; ownerScope: string } | undefined {
  const ownerScope = String(request.headers['x-owner-scope'] ?? '');
  if (!ownerScope.startsWith(ANON_PREFIX)) return undefined;
  const sessionId = ownerScope.slice(ANON_PREFIX.length);
  if (sessionId.length === 0) return undefined;
  return { sessionId, ownerScope };
}

export function registerAnonymousQuotaRoutes(app: FastifyInstance, deps: AnonymousQuotaDeps): void {
  /** Render-time projection. Never the authority for whether a turn may run. */
  app.get('/api/ai/anonymous/quota', async (request, reply) => {
    const anon = anonymousScope(request);
    if (!anon) return bad(reply, 400, 'NOT_ANONYMOUS', 'This route requires an anon: owner scope.');

    const store = deps.store();
    if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

    const row = await store.getAnonymousQuota(anon.sessionId, anon.ownerScope);
    // A visitor with no row yet has used nothing — reporting their full
    // allowance is the truth, and creating a row just to answer a read would
    // let a page view consume storage.
    return {
      ok: true,
      quota: evaluateAnonymousQuota({ limit: row?.turnLimit ?? deps.turnLimit(), used: row?.used ?? 0 }),
      claimed: Boolean(row?.claimedBy),
    };
  });

  /**
   * Take one turn's allowance BEFORE inference runs.
   *
   * Refusal here is the thing that stops the model being called at all. A check
   * after generation is not a limit, it is a receipt.
   */
  app.post<{ Body: { reservationId?: string; conversationId?: string } }>(
    '/api/ai/anonymous/reserve',
    async (request, reply) => {
      const anon = anonymousScope(request);
      if (!anon) return bad(reply, 400, 'NOT_ANONYMOUS', 'This route requires an anon: owner scope.');

      const store = deps.store();
      if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

      const reservationId = request.body?.reservationId ?? deps.newId();
      const result = await store.reserveAnonymousTurn({
        anonymousSessionId: anon.sessionId,
        ownerScope: anon.ownerScope,
        turnLimit: deps.turnLimit(),
        reservationId,
        holdMs: deps.holdMs(),
        now: deps.now(),
        ...(request.body?.conversationId ? { conversationId: request.body.conversationId } : {}),
      });

      const quota = evaluateAnonymousQuota({ limit: result.quota.turnLimit, used: result.quota.used });
      if (!result.ok) {
        // 429, not 403: the visitor is not forbidden, they are out of turns and
        // signing in changes that.
        reply.code(429);
        return { ok: false, code: 'QUOTA_EXHAUSTED', quota };
      }
      return { ok: true, reservation: { reservationId, remainingAfterReservation: quota.remaining }, quota };
    },
  );

  /**
   * Settle a reservation once the turn is over.
   *
   * The policy lives in the shared contract, not here: a turn that produced
   * output consumes the allowance even if the user disliked it; infrastructure
   * failing before useful output returns it.
   */
  app.post<{ Body: { reservationId?: string; producedOutput?: boolean; failure?: string } }>(
    '/api/ai/anonymous/settle',
    async (request, reply) => {
      const anon = anonymousScope(request);
      if (!anon) return bad(reply, 400, 'NOT_ANONYMOUS', 'This route requires an anon: owner scope.');

      const reservationId = request.body?.reservationId;
      if (typeof reservationId !== 'string' || reservationId.length === 0) {
        return bad(reply, 400, 'INVALID_INPUT', 'A reservationId is required.');
      }
      const store = deps.store();
      if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

      const producedOutput = request.body?.producedOutput === true;
      if (producedOutput) {
        try {
          await store.consumeAnonymousReservation(reservationId, anon.ownerScope, deps.now());
        } catch (error) {
          // Already settled, or not this visitor's. Either way the caller's
          // belief about what it just charged for is wrong, and saying so beats
          // pretending the spend landed.
          return bad(reply, 409, 'RESERVATION_NOT_HELD',
            error instanceof Error ? error.message : 'Reservation could not be consumed.');
        }
        return { ok: true, settlement: 'consume' };
      }

      const released = await store.releaseAnonymousReservation(reservationId, anon.ownerScope);
      return { ok: true, settlement: 'release', released };
    },
  );

  /**
   * Move an anonymous conversation into the account that just signed in.
   *
   * Made AS the account: `x-owner-scope` is the authenticated scope, and the
   * anonymous side is named in the body. The pair is checked structurally, so a
   * request naming an anonymous owner that does not match its session id is
   * refused before any row moves.
   */
  app.post<{ Body: { conversationId?: string; anonymousSessionId?: string; anonymousOwner?: string } }>(
    '/api/ai/anonymous/claim',
    async (request, reply) => {
      const accountOwner = String(request.headers['x-owner-scope'] ?? '');
      const accountWorkspace = String(request.headers['x-workspace-scope'] ?? '');
      if (!accountOwner || accountOwner.startsWith(ANON_PREFIX)) {
        return bad(reply, 400, 'NOT_AUTHENTICATED_SCOPE',
          'A claim must be made as the signed-in account, not as an anonymous visitor.');
      }

      const { conversationId, anonymousSessionId, anonymousOwner } = request.body ?? {};
      if (!conversationId || !anonymousSessionId || !anonymousOwner) {
        return bad(reply, 400, 'INVALID_INPUT',
          'conversationId, anonymousSessionId and anonymousOwner are all required.');
      }
      if (anonymousOwner !== `${ANON_PREFIX}${anonymousSessionId}`) {
        // A mismatched pair means the caller assembled it rather than deriving
        // it from one verified cookie.
        return bad(reply, 400, 'ANONYMOUS_SCOPE_MISMATCH',
          'anonymousOwner must be anon: followed by anonymousSessionId.');
      }

      const store = deps.store();
      if (!store) return bad(reply, 503, 'PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.');

      try {
        const outcome = await store.claimAnonymousConversation({
          conversationId, anonymousSessionId, anonymousOwner,
          accountOwner, accountWorkspace, now: deps.now(),
        });
        /*
         * ONLY AFTER THE TRANSACTION COMMITTED. A cache dropped before the
         * commit would be re-filled from the pre-move rows by any concurrent
         * read, leaving the same staleness this call exists to remove — and a
         * rolled-back claim would have evicted for nothing.
         *
         * Both scopes: the visitor must stop seeing what they no longer own,
         * and the account was very likely hydrated before this row arrived.
         */
        deps.onClaimed({ anonymousOwner, accountOwner, accountWorkspace });
        return { ok: true, ...outcome, claimed: true };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already claimed/i.test(message)) {
          return bad(reply, 409, 'ALREADY_CLAIMED', message);
        }
        if (/not visible|could not be removed/i.test(message)) {
          // NOT_FOUND deliberately covers "does not exist" and "not yours" —
          // distinguishing them would confirm the existence of other people's
          // conversations to anyone willing to guess ids.
          return bad(reply, 404, 'NOT_FOUND', 'That conversation is not available to claim.');
        }
        throw error;
      }
    },
  );
}
