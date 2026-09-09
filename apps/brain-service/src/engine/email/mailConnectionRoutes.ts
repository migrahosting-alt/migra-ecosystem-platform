/**
 * MAIL CONNECTION ROUTES — begin, callback, status, disconnect.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE SCOPE ALWAYS COMES FROM THE REQUEST'S IDENTITY, NEVER ITS BODY
 *
 * Every handler starts from `deps.scopeFrom(request)`. No handler reads an
 * owner, a workspace or a user id out of a payload, and none accepts a provider
 * account id as the sole way to find a connection. That is the whole of the
 * ownership model at this layer: a request can ask about "my mail" and nothing
 * else.
 *
 * ---------------------------------------------------------------------------
 * 🚨 NOTHING HERE RETURNS A TOKEN, A SCOPE STRING OR A GOOGLE ERROR CODE
 *
 * The status shape is the engine's own vocabulary. A response that named
 * `gmail.readonly` or `invalid_grant` would describe the machinery to someone
 * who asked about their email, and would put provider vocabulary in a place
 * the consumer is forbidden to speak it.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { Scope } from '../memory/conversationStore.js';

import {
  beginConnection,
  completeConnection,
  connectionStatus,
  disconnectConnection,
  type ConnectionServiceDeps,
} from './connectionService.js';
import { callbackRefusalMessage } from './oauthFlow.js';
import { storeRefusalMessage } from './connectionStore.js';
import { DEFAULT_GRANTS } from './googleOAuthClient.js';

export interface MailRouteDeps {
  service: ConnectionServiceDeps;
  scopeFrom(request: FastifyRequest): Scope;
  /** The provider this deployment offers. One today; not hardcoded downstream. */
  provider: string;
}

interface BeginBody {
  returnTo?: unknown;
}

interface CallbackBody {
  state?: unknown;
  code?: unknown;
  error?: unknown;
}

interface DisconnectBody {
  providerAccountId?: unknown;
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function registerMailConnectionRoutes(app: FastifyInstance, deps: MailRouteDeps): void {
  /**
   * Where to send the user to consent.
   *
   * POST, not GET: it MINTS state and writes a row, so it is not something a
   * link preview, a prefetch or a crawler should be able to trigger.
   */
  app.post<{ Body: BeginBody }>('/api/ai/account/mail/begin', async (request) => {
    const scope = deps.scopeFrom(request);
    const begun = await beginConnection({
      scope,
      provider: deps.provider,
      // Read scope only. Send is not requested until governed send is wired and
      // qualified — asking for the irreversible permission first is asking on
      // the strength of a promise.
      grants: DEFAULT_GRANTS,
      ...(str(request.body?.returnTo) ? { returnTo: str(request.body?.returnTo)! } : {}),
      deps: deps.service,
    });
    return { authorizationUrl: begun.authorizationUrl };
  });

  /**
   * Complete a consent.
   *
   * The consumer receives Google's redirect and forwards the parameters here
   * with the session's identity attached. The Brain decides everything; the
   * consumer only knows where to send the browser afterwards.
   */
  app.post<{ Body: CallbackBody }>('/api/ai/account/mail/callback', async (request, reply) => {
    const scope = deps.scopeFrom(request);
    const result = await completeConnection({
      scope,
      state: str(request.body?.state),
      code: str(request.body?.code),
      error: str(request.body?.error),
      deps: deps.service,
    });

    if (result.ok) {
      return { connected: true, returnTo: result.returnTo, account: result.account.accountAddress };
    }

    /*
     * 400, not 500: a forged, replayed or expired callback is a refusal, not a
     * fault. Reporting it as a server error would page someone every time a
     * user left a consent screen open too long.
     */
    reply.code(400);
    if ('refusal' in result) {
      return { connected: false, message: callbackRefusalMessage(result.refusal) };
    }
    return { connected: false, message: storeRefusalMessage(result.storeRefusal) };
  });

  /** What the UI shows. Engine vocabulary only. */
  app.get('/api/ai/account/mail', async (request) => {
    const scope = deps.scopeFrom(request);
    const status = await connectionStatus({
      scope,
      provider: deps.provider,
      providerConfigured: true,
      connections: deps.service.connections,
      now: deps.service.now,
    });
    return status;
  });

  /**
   * Disconnect.
   *
   * DELETE with a body is awkward but correct here: the account id narrows
   * within the caller's own scope, and putting it in the path would make a
   * mailbox identifier a routable, loggable URL component.
   */
  app.delete<{ Body: DisconnectBody }>('/api/ai/account/mail', async (request, reply) => {
    const scope = deps.scopeFrom(request);

    /*
     * When no account is named, the server picks — but only when there is
     * exactly one. Silently disconnecting the first of several would remove a
     * mailbox the user did not choose, and there is no undo.
     */
    const owned = await deps.service.connections.list(scope, deps.provider);
    const named = str(request.body?.providerAccountId);
    const target = named
      ? owned.find((c) => c.providerAccountId === named)
      : owned.length === 1
        ? owned[0]
        : undefined;

    if (!target) {
      reply.code(owned.length > 1 && !named ? 409 : 404);
      return {
        removed: false,
        message: owned.length > 1 && !named
          ? 'Choose which account to disconnect.'
          : 'That email account is not connected.',
      };
    }

    const result = await disconnectConnection({
      scope,
      provider: deps.provider,
      providerAccountId: target.providerAccountId,
      deps: deps.service,
    });

    return {
      removed: result.removed,
      /*
       * Said plainly when true. Reporting a clean disconnection we did not
       * achieve is the one outcome that leaves someone believing their mail is
       * disconnected when it is not.
       */
      ...(result.mayRemainAtProvider
        ? {
            message:
              'Your account was disconnected here, but we could not confirm it with the provider. '
              + 'Check the third-party access settings in your account to remove it there too.',
          }
        : {}),
    };
  });
}
