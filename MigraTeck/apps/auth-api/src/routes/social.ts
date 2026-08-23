/**
 * Sign in with Google or GitHub.
 *
 *   /v1/social/:provider/start     → the provider's consent screen
 *   /v1/social/:provider/callback  → back here, with a session established
 *
 * THIS DOES NOT KNOW ABOUT MIGRAPILOT, and that is the design. A provider
 * sign-in ends by establishing the SAME first-party MigraAuth session a password
 * login establishes, then returning the browser to wherever it came from —
 * normally `/authorize?...`, which finds the session and completes the OIDC
 * exchange it was already in the middle of. So every downstream behaviour the
 * product already has — the `next` destination, the anonymous conversation
 * claim, conversation ids surviving — keeps working without a line of it being
 * aware that Google exists.
 *
 * NO PROVIDER NAMES APPEAR BELOW. Everything provider-specific is a descriptor
 * in `modules/social/providers.ts`; these handlers are the same for the third
 * provider as for the first.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import {
  availableProviders,
  callbackUrlFor,
  describeProvider,
  ProviderError,
  resolveConfiguredProvider,
  type ProviderDescriptor,
} from "../modules/social/providers.js";
import { consumeLoginState, createLoginState } from "../modules/social/state.js";
import { listLinkedIdentities, resolveProviderSignIn, unlinkProvider } from "../modules/social/index.js";
import { defaultReturnTo, errorReturnTo, safeReturnTo, withOutcome } from "../modules/social/redirect.js";
import { establishFirstPartySession } from "./auth.js";
import {
  attachProvider,
  consumeTransaction,
  loadTransaction,
} from "../modules/authorization/transaction.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { revokeAllUserSessions } from "../modules/sessions/index.js";
import { createAuthCode } from "../modules/tokens/index.js";
import { updateLastLogin } from "../modules/users/index.js";
import { requireAuthenticatedUser, optionalSession, getClientIp } from "../middleware/session.js";
import type { IdentityProvider } from "../prisma-client.js";

/** The enum value for a descriptor. Kept here so the modules stay untyped-by-slug. */
const providerEnum = (descriptor: ProviderDescriptor): IdentityProvider =>
  descriptor.id as IdentityProvider;

/**
 * A failure is reported to the DESTINATION, not rendered here.
 *
 * The person is mid-sign-in on a product page; dropping them on a bare JSON
 * error from an API host they have never heard of loses both the flow and the
 * conversation they were having. The reason travels as a parameter the web UI
 * renders, and the destination is one that already passed the allowlist.
 */
function bounce(reply: FastifyReply, returnTo: string, params: Record<string, string>): void {
  void reply.redirect(withOutcome(returnTo, params), 302);
}

export async function socialRoutes(app: FastifyInstance): Promise<void> {
  /**
   * What the sign-in UI may offer.
   *
   * Read by auth-web so an unconfigured provider is ABSENT rather than present
   * and broken. A button that leads to a consent screen for a client that does
   * not exist is worse than no button: it looks like the product is broken
   * rather than like the feature is off.
   */
  app.get("/v1/social/providers", async () => ({
    providers: availableProviders(),
  }));

  // ── start ─────────────────────────────────────────────────────────
  app.get<{ Params: { provider: string }; Querystring: { return_to?: string; mode?: string; txn?: string } }>(
    "/v1/social/:provider/start",
    { preHandler: optionalSession },
    async (request, reply) => {
      const slug = request.params.provider.toLowerCase();
      /*
       * `txn` IS THE PREFERRED HANDOFF, and `return_to` is the fallback for
       * flows that are not completing an authorization request — linking a
       * provider from settings, or signing in at MigraAuth itself.
       *
       * When a transaction is named, the destination is NOT a URL the browser
       * supplied: it is rebuilt from the transaction row after the provider
       * returns. This is what stops a provider round trip from being able to
       * lose, reorder or alter the request it is interrupting.
       */
      const txn = typeof request.query.txn === "string" ? request.query.txn : "";
      const returnTo = safeReturnTo(request.query.return_to) ?? defaultReturnTo();

      const resolved = resolveConfiguredProvider(slug);
      if (!resolved) {
        /*
         * "Not configured" and "not a provider" are the same answer on purpose.
         * Distinguishing them tells an unauthenticated caller which providers a
         * deployment has credentials for, which is inventory it has no use for.
         */
        return bounce(reply, returnTo, {
          auth_error: describeProvider(slug) ? "provider_unavailable" : "unknown_provider",
        });
      }

      const mode = request.query.mode === "link" ? "link" : "login";
      const sessionUserId = request.authUser?.id ?? null;
      if (mode === "link" && !sessionUserId) {
        return bounce(reply, returnTo, { auth_error: "link_requires_session" });
      }

      const { descriptor, credentials } = resolved;

      /*
       * A named transaction must still be OPEN before the user is sent away.
       * Discovering it expired only after the provider round trip wastes the
       * user's time and leaves them somewhere they cannot act on.
       */
      if (txn) {
        const found = await loadTransaction(txn);
        if (!found.ok) {
          return void reply.redirect(errorReturnTo(`transaction_${found.reason}`), 302);
        }
        await attachProvider(txn, providerEnum(descriptor));
      }

      const created = await createLoginState({
        provider: providerEnum(descriptor),
        mode,
        returnTo,
        transactionId: txn || null,
        linkUserId: mode === "link" ? sessionUserId : null,
        ip: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });

      const params = new URLSearchParams({
        response_type: "code",
        client_id: credentials.clientId,
        // Derived from the implemented route, so what is registered at the
        // provider and what is sent can never drift apart.
        redirect_uri: callbackUrlFor(slug),
        scope: descriptor.scope,
        state: created.state,
        ...(descriptor.authorizeParams ?? {}),
      });

      if (descriptor.usesPkce) {
        params.set("code_challenge", created.codeChallenge);
        params.set("code_challenge_method", "S256");
        params.set("nonce", created.nonce);
      }

      return reply.redirect(`${descriptor.authorizeUrl}?${params.toString()}`, 302);
    },
  );

  // ── callback ──────────────────────────────────────────────────────
  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string; error_description?: string };
  }>("/v1/social/:provider/callback", { preHandler: optionalSession }, async (request, reply) => {
    const slug = request.params.provider.toLowerCase();
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    const resolved = resolveConfiguredProvider(slug);
    if (!resolved) return bounce(reply, defaultReturnTo(), { auth_error: "unknown_provider" });
    const { descriptor, credentials } = resolved;

    /*
     * THE STATE IS SPENT FIRST, whatever else the callback says.
     *
     * Including when the provider reports a cancellation. A state left unspent
     * because the user clicked "Deny" is a state still available to replay, and
     * consuming it here also recovers the `return_to` needed to put them back
     * where they were — which is the difference between "you cancelled, here is
     * your conversation" and dropping them on a stranger's error page.
     */
    const outcome = await consumeLoginState({
      state: request.query.state ?? "",
      provider: providerEnum(descriptor),
    });

    if (!outcome.ok) {
      await logAuditEvent({
        eventType: "SOCIAL_LOGIN_FAILURE",
        eventData: { provider: slug, reason: outcome.reason },
        ipAddress: ip,
        userAgent: ua,
      });
      /*
       * Deliberately NOT a caller-supplied destination: without a verified state
       * there is no destination this request has proven. The branded error page
       * states the reason and survives, where `/sessions` would bounce an
       * unauthenticated visitor to `/login` and lose it.
       */
      return void reply.redirect(errorReturnTo(`state_${outcome.reason}`), 302);
    }

    const state = outcome.state;
    // Re-validated on use. It passed on the way in, but that was a different
    // request, and the check costs nothing.
    const returnTo = safeReturnTo(state.returnTo) ?? defaultReturnTo();

    /*
     * A CANCELLED SIGN-IN IS NOT A FAULT. The provider says `access_denied`
     * when someone changes their mind, and the honest response is to put them
     * back exactly where they were with nothing lost — their anonymous
     * conversation included, because none of it was touched.
     */
    if (request.query.error) {
      await logAuditEvent({
        eventType: "SOCIAL_LOGIN_CANCELLED",
        eventData: { provider: slug, error: request.query.error },
        ipAddress: ip,
        userAgent: ua,
      });
      return bounce(reply, returnTo, {
        auth_error: request.query.error === "access_denied" ? "provider_cancelled" : "provider_error",
      });
    }

    if (!request.query.code) {
      return bounce(reply, returnTo, { auth_error: "provider_error" });
    }

    let profile;
    try {
      const accessToken = await exchangeCode({
        descriptor,
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        code: request.query.code,
        redirectUri: callbackUrlFor(slug),
        codeVerifier: state.codeVerifier,
      });
      profile = await descriptor.fetchProfile(accessToken);
    } catch (error) {
      // The provider's own message can carry request detail; the log gets it,
      // the URL never does.
      app.log.warn(
        { provider: slug, err: error instanceof Error ? error.message : String(error) },
        "social exchange failed",
      );
      await logAuditEvent({
        eventType: "SOCIAL_LOGIN_FAILURE",
        eventData: { provider: slug, reason: "exchange_failed" },
        ipAddress: ip,
        userAgent: ua,
      });
      return bounce(reply, returnTo, { auth_error: "provider_exchange_failed" });
    }

    const result = await resolveProviderSignIn({
      provider: providerEnum(descriptor),
      profile,
      mode: state.mode,
      sessionUserId: state.linkUserId ?? request.authUser?.id ?? null,
    });

    if (!result.ok) {
      await logAuditEvent({
        eventType: "SOCIAL_LOGIN_REFUSED",
        eventData: { provider: slug, reason: result.code },
        ipAddress: ip,
        userAgent: ua,
      });
      return bounce(reply, returnTo, { auth_error: result.code });
    }

    // Linking from settings must not disturb the session that asked for it.
    if (result.decision.kind === "link_to_session") {
      await logAuditEvent({
        actorUserId: result.user.id,
        eventType: "SOCIAL_LINK_ADDED",
        eventData: { provider: slug },
        ipAddress: ip,
        userAgent: ua,
      });
      return bounce(reply, returnTo, { linked: slug });
    }

    /*
     * SESSION ROTATION ON AUTHENTICATION.
     *
     * Every session this browser held before the provider proved anything is
     * revoked, and a fresh one is issued. Without it, a session fixated before
     * the flow began would still be valid afterwards — now carrying the
     * authority of whoever just signed in.
     */
    await revokeAllUserSessions(result.user.id);
    await establishFirstPartySession({ reply, userId: result.user.id, ip, userAgent: ua });
    await updateLastLogin(result.user.id);

    /*
     * RESUME THE ORIGINAL REQUEST FROM SERVER STATE.
     *
     * Everything the code is bound to — client, redirect, scopes, PKCE
     * challenge, the client's own state — is read from the transaction row. The
     * browser contributed one opaque id and nothing else, so nothing it carried
     * through Google or GitHub could have altered the request being completed.
     */
    if (state.transactionId) {
      const outcome = await consumeTransaction({ id: state.transactionId, userId: result.user.id });
      if (!outcome.ok) {
        await logAuditEvent({
          actorUserId: result.user.id,
          eventType: "SOCIAL_LOGIN_FAILURE",
          eventData: { provider: slug, reason: `transaction_${outcome.reason}` },
          ipAddress: ip,
          userAgent: ua,
        });
        // The person IS signed in; only the request they were completing is
        // gone. The branded page says which, and `/sessions` would not.
        return void reply.redirect(errorReturnTo(`transaction_${outcome.reason}`), 302);
      }

      const t = outcome.transaction;
      const code = await createAuthCode(
        result.user.id,
        t.clientId,
        t.redirectUri,
        t.codeChallenge,
        t.codeChallengeMethod,
        t.scope ? t.scope.split(" ") : ["openid"],
        t.nonce ?? undefined,
        { issuedIp: ip, issuedUserAgent: ua },
      );

      await logAuditEvent({
        actorUserId: result.user.id,
        eventType: "SOCIAL_LOGIN_SUCCESS",
        eventData: { provider: slug, created_account: result.created, via_transaction: true },
        ipAddress: ip,
        userAgent: ua,
      });

      const redirectUrl = new URL(t.redirectUri);
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("state", t.clientState);
      return reply.redirect(redirectUrl.toString(), 302);
    }

    await logAuditEvent({
      actorUserId: result.user.id,
      eventType: "SOCIAL_LOGIN_SUCCESS",
      eventData: {
        provider: slug,
        created_account: result.created,
        linked_existing: result.linked && !result.created,
      },
      ipAddress: ip,
      userAgent: ua,
    });

    return bounce(reply, returnTo, {});
  });

  // ── linked providers, for account settings ────────────────────────
  app.get("/v1/social/links", { preHandler: requireAuthenticatedUser }, async (request) => {
    const links = await listLinkedIdentities(request.authUser!.id);
    return {
      links: links.map((link) => ({
        provider: link.provider.toLowerCase(),
        email: link.email,
        display_name: link.displayName,
        linked_at: link.linkedAt,
        last_used_at: link.lastUsedAt,
      })),
    };
  });

  app.delete<{ Params: { provider: string } }>(
    "/v1/social/:provider/link",
    { preHandler: requireAuthenticatedUser },
    async (request, reply) => {
      const descriptor = describeProvider(request.params.provider.toLowerCase());
      if (!descriptor) {
        return reply.code(404).send({ error: { code: "unknown_provider", message: "No such provider." } });
      }

      const result = await unlinkProvider({
        userId: request.authUser!.id,
        provider: providerEnum(descriptor),
      });
      if (!result.ok) {
        return reply.code(409).send({ error: { code: result.code, message: result.message } });
      }

      await logAuditEvent({
        actorUserId: request.authUser!.id,
        eventType: "SOCIAL_LINK_REMOVED",
        eventData: { provider: request.params.provider.toLowerCase() },
        ipAddress: getClientIp(request),
        userAgent: request.headers["user-agent"],
      });
      return reply.code(200).send({ unlinked: true });
    },
  );
}

/**
 * Trade the authorization code for an access token.
 *
 * The client secret goes in the POST BODY over TLS and appears nowhere else —
 * not in a redirect, not in a log line, not in an error returned to a browser.
 */
async function exchangeCode(input: {
  descriptor: ProviderDescriptor;
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  });
  // Sent only to providers that honour it. A verifier a provider ignores is not
  // protection, and pretending otherwise is worse than not claiming it.
  if (input.descriptor.usesPkce) body.set("code_verifier", input.codeVerifier);

  const response = await fetch(input.descriptor.tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      // GitHub answers form-encoded unless asked otherwise.
      accept: "application/json",
      "user-agent": "MigraAuth",
    },
    body,
  });

  if (!response.ok) throw new ProviderError(`token exchange failed (${response.status})`);
  const payload = (await response.json()) as { access_token?: string; error?: string };
  if (payload.error || !payload.access_token) {
    throw new ProviderError(`token exchange refused (${payload.error ?? "no access_token"})`);
  }
  return payload.access_token;
}
