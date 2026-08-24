/**
 * OAuth 2.1 routes — /authorize, /token, /revoke, /userinfo, OIDC discovery.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authorizeQuerySchema, tokenExchangeSchema, revokeSchema } from "../lib/schemas.js";
import { findClientById, isConfidentialClient, validateRedirectUri, validateScopes, verifyRegisteredClientSecret } from "../modules/clients/index.js";
import { createAuthCode, exchangeAuthCode, rotateRefreshToken, revokeRefreshTokenFamily } from "../modules/tokens/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { getJWKS, getOpenIDConfiguration } from "../lib/jwt.js";
import { config } from "../config/env.js";
import { randomUUID } from "node:crypto";
import {
  consumeTransaction,
  createTransaction,
  loadTransaction,
  toPublicView,
} from "../modules/authorization/transaction.js";
import { requireAuthenticatedUser, requireSession, optionalSession, getClientIp } from "../middleware/session.js";
import { stampSessionClient } from "../modules/sessions/index.js";

function parseBasicClientAuth(authorization?: string) {
  if (!authorization?.startsWith("Basic ")) {
    return null;
  }

  const encoded = authorization.slice(6).trim();
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    clientId: decoded.slice(0, separatorIndex),
    clientSecret: decoded.slice(separatorIndex + 1),
  };
}

export async function oauthRoutes(app: FastifyInstance): Promise<void> {

  // ── GET /authorize ────────────────────────────────────────────────
  // This is the authorization endpoint. Products redirect users here.
  // If the user has a valid session, we issue a code immediately.
  // Otherwise, redirect to the login page on auth-web.
  /**
   * Refuse an authorization request through a BRANDED surface.
   *
   * Fails closed exactly as before — nothing is relaxed, no defaults are
   * invented, no request proceeds. What changes is that the person sees a
   * MigraAuth page naming what went wrong, with a correlation id they can quote,
   * instead of our schema internals. The id is logged here and shown there; the
   * detail stays server-side.
   */
  function failAuthorize(
    reply: FastifyReply,
    code: string,
    request: FastifyRequest,
  ): FastifyReply {
    const requestId = randomUUID();
    app.log.warn(
      { requestId, code, url: request.url, ip: getClientIp(request) },
      "authorize request refused",
    );
    const errorUrl = new URL("/error", config.webUrl);
    errorUrl.searchParams.set("code", code);
    errorUrl.searchParams.set("request_id", requestId);
    return reply.redirect(errorUrl.toString(), 302);
  }

  app.get("/authorize", { preHandler: optionalSession }, async (request, reply) => {
    /*
     * A MALFORMED REQUEST IS STILL A USER LOOKING AT A SCREEN.
     *
     * This used to let the schema throw, and the global handler answered with
     * raw validation JSON — field paths, expected literals, internal schema
     * shape — rendered as a wall of text to someone who had just tried to sign
     * in. It fails closed either way; the difference is whether the person is
     * told something they can act on and we get a correlation id to trace, or
     * they are shown our zod output.
     */
    const parsed = authorizeQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return failAuthorize(reply, "invalid_request", request);
    }
    const query = parsed.data;

    const client = await findClientById(query.client_id);
    if (!client || !client.isActive) {
      return failAuthorize(reply, "unknown_client", request);
    }
    if (!validateRedirectUri(client, query.redirect_uri)) {
      // NEVER redirect to an unregistered URI to report that it is unregistered.
      return failAuthorize(reply, "invalid_redirect_uri", request);
    }

    // Validate scopes
    const requestedScopes = query.scope ? query.scope.split(" ") : ["openid"];
    const validScopes = validateScopes(client, requestedScopes);

    // If user is already authenticated, issue code immediately (SSO), unless
    // the client explicitly asks for a fresh login/account switch.
    if (request.authUser && request.authUser.status === "ACTIVE" && query.prompt !== "login") {
      const code = await createAuthCode(
        request.authUser.id,
        query.client_id,
        query.redirect_uri,
        query.code_challenge,
        query.code_challenge_method,
        validScopes,
        query.nonce,
        { issuedIp: getClientIp(request), issuedUserAgent: request.headers["user-agent"] },
      );

      const redirectUrl = new URL(query.redirect_uri);
      redirectUrl.searchParams.set("code", code);
      redirectUrl.searchParams.set("state", query.state);

      return reply.redirect(redirectUrl.toString());
    }

    /*
     * NOT AUTHENTICATED — OPEN A TRANSACTION AND HAND OVER ONE REFERENCE.
     *
     * The request used to be copied into the login URL as a dozen parameters and
     * carried by the browser through login, a provider round trip, and back.
     * Every hop was a chance to lose one, and a lost parameter is not a degraded
     * flow: it is an invalid request MigraAuth must reject, in front of someone
     * who has just signed in successfully. That is precisely the regression this
     * replaces.
     *
     * The browser now carries `txn` and nothing else. Client, redirect, scopes,
     * PKCE challenge and the client's own state are read back from the row when
     * the code is issued, so they cannot be dropped, reordered or edited between
     * hops — there is nothing in between to edit.
     */
    const transaction = await createTransaction({
      clientId: query.client_id,
      redirectUri: query.redirect_uri,
      responseType: "code",
      scope: validScopes.join(" "),
      clientState: query.state,
      codeChallenge: query.code_challenge,
      codeChallengeMethod: query.code_challenge_method,
      nonce: query.nonce,
      prompt: query.prompt,
      loginHint: query.login_hint,
      ip: getClientIp(request),
      userAgent: request.headers["user-agent"],
    });

    const loginUrl = new URL("/login", config.webUrl);
    loginUrl.searchParams.set("txn", transaction.id);
    return reply.redirect(loginUrl.toString());
  });

  /**
   * What the login screen may know about a pending request.
   *
   * Deliberately narrow — the product name to brand itself with, and nothing
   * else. The PKCE challenge, redirect URI and client state are never sent to a
   * browser, because anything handed to a browser is something a browser can
   * alter.
   */
  app.get<{ Params: { id: string } }>("/v1/authorize/transaction/:id", async (request, reply) => {
    const found = await loadTransaction(request.params.id);
    if (!found.ok) {
      return reply.code(404).send({ error: { code: found.reason, message: "That sign-in request is no longer valid." } });
    }
    return reply.send({ transaction: toPublicView(found.transaction as never) });
  });

  /**
   * Finish a transaction for the user who is now authenticated.
   *
   * REBUILT FROM THE ROW, NOT FROM THE REQUEST. The body carries one opaque id;
   * everything the code is bound to comes from server state. There is no
   * browser-supplied redirect URI to validate here, because the only one that
   * exists is the one validated when the transaction opened.
   */
  app.post<{ Body: { txn?: string } }>(
    "/authorize/resume",
    { preHandler: requireSession },
    async (request, reply) => {
      const user = request.authUser!;
      const id = typeof request.body?.txn === "string" ? request.body.txn : "";

      const outcome = await consumeTransaction({ id, userId: user.id });
      if (!outcome.ok) {
        return reply.code(409).send({
          error: {
            code: outcome.reason,
            message:
              outcome.reason === "already_used"
                ? "That sign-in request was already completed."
                : "That sign-in request is no longer valid. Start again from the app.",
          },
        });
      }

      const t = outcome.transaction;

      /*
       * THE SESSION NOW REMEMBERS WHICH PRODUCT IT IS IN.
       *
       * Read later by account-security surfaces, which are opened by a plain
       * link from a product's settings and so have no transaction of their own
       * to consult. Stamped here because this is the moment the trusted client
       * and the authenticated session are both in hand.
       */
      if (request.authSession) {
        await stampSessionClient(request.authSession.id, t.clientId);
      }

      const code = await createAuthCode(
        user.id,
        t.clientId,
        t.redirectUri,
        t.codeChallenge,
        t.codeChallengeMethod,
        t.scope ? t.scope.split(" ") : ["openid"],
        t.nonce ?? undefined,
        { issuedIp: getClientIp(request), issuedUserAgent: request.headers["user-agent"] },
      );

      const redirectUrl = new URL(t.redirectUri);
      redirectUrl.searchParams.set("code", code);
      // The CLIENT's own state, echoed back untouched.
      redirectUrl.searchParams.set("state", t.clientState);

      return reply.send({ redirect_to: redirectUrl.toString() });
    },
  );

  // ── POST /authorize/complete ──────────────────────────────────────
  // Called by auth-web after successful login to issue the auth code.
  app.post("/authorize/complete", { preHandler: requireSession }, async (request, reply) => {
    const body = authorizeQuerySchema.parse(request.body);
    const user = request.authUser!;

    // Validate client
    const client = await findClientById(body.client_id);
    if (!client || !client.isActive) {
      return reply.code(400).send({ error: { code: "invalid_client", message: "Unknown client_id." } });
    }
    if (!validateRedirectUri(client, body.redirect_uri)) {
      return reply.code(400).send({ error: { code: "invalid_redirect_uri", message: "redirect_uri not registered." } });
    }

    const requestedScopes = body.scope ? body.scope.split(" ") : ["openid"];
    const validScopes = validateScopes(client, requestedScopes);

    const code = await createAuthCode(
      user.id,
      body.client_id,
      body.redirect_uri,
      body.code_challenge,
      body.code_challenge_method,
      validScopes,
      body.nonce,
      { issuedIp: getClientIp(request), issuedUserAgent: request.headers["user-agent"] },
    );

    return reply.code(200).send({
      redirect_uri: body.redirect_uri,
      code,
      state: body.state,
    });
  });

  // ── POST /token ───────────────────────────────────────────────────
  app.post("/token", async (request, reply) => {
    const body = tokenExchangeSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];
    const basicAuth = parseBasicClientAuth(request.headers.authorization);

    if (basicAuth?.clientId && basicAuth.clientId !== body.client_id) {
      return reply.code(401).send({
        error: { code: "invalid_client", message: "Client authentication did not match client_id." },
      });
    }

    const client = await findClientById(body.client_id);
    if (!client || !client.isActive) {
      return reply.code(401).send({
        error: { code: "invalid_client", message: "Unknown or inactive client_id." },
      });
    }

    if (isConfidentialClient(client)) {
      const presentedSecret = body.client_secret ?? basicAuth?.clientSecret;
      if (!verifyRegisteredClientSecret(client, presentedSecret)) {
        return reply.code(401).send({
          error: { code: "invalid_client", message: "Client authentication failed." },
        });
      }
    }

    if (body.grant_type === "authorization_code") {
      if (!body.code || !body.code_verifier || !body.redirect_uri) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "code, code_verifier, and redirect_uri are required." },
        });
      }

      const tokenSet = await exchangeAuthCode(
        body.code,
        body.code_verifier,
        body.client_id,
        body.redirect_uri,
      );

      if (!tokenSet) {
        return reply.code(400).send({
          error: { code: "invalid_grant", message: "Authorization code is invalid, expired, or PKCE verification failed." },
        });
      }

      await logAuditEvent({
        eventType: "TOKEN_REFRESH",
        eventData: { grant: "authorization_code", client: body.client_id },
        ipAddress: ip,
        userAgent: ua,
      });

      return reply.code(200).send(tokenSet);
    }

    if (body.grant_type === "refresh_token") {
      if (!body.refresh_token) {
        return reply.code(400).send({
          error: { code: "invalid_request", message: "refresh_token is required." },
        });
      }

      const tokenSet = await rotateRefreshToken(body.refresh_token, body.client_id);
      if (!tokenSet) {
        await logAuditEvent({
          eventType: "TOKEN_REUSE_DETECTED",
          eventData: { client: body.client_id },
          ipAddress: ip,
          userAgent: ua,
        });
        return reply.code(400).send({
          error: { code: "invalid_grant", message: "Refresh token is invalid, expired, or reused." },
        });
      }

      await logAuditEvent({
        eventType: "TOKEN_REFRESH",
        eventData: { grant: "refresh_token", client: body.client_id },
        ipAddress: ip,
        userAgent: ua,
      });

      return reply.code(200).send(tokenSet);
    }

    return reply.code(400).send({ error: { code: "unsupported_grant_type", message: "Unsupported grant_type." } });
  });

  // ── POST /revoke ──────────────────────────────────────────────────
  app.post("/revoke", async (request, reply) => {
    const body = revokeSchema.parse(request.body);
    const ip = getClientIp(request);
    const ua = request.headers["user-agent"];

    await revokeRefreshTokenFamily(body.token);

    await logAuditEvent({
      eventType: "TOKEN_REVOKE",
      ipAddress: ip,
      userAgent: ua,
    });

    // Always return 200 per RFC 7009
    return reply.code(200).send({ revoked: true });
  });

  // ── GET /userinfo ─────────────────────────────────────────────────
  app.get("/userinfo", { preHandler: requireAuthenticatedUser }, async (request, reply) => {
    const user = request.authUser!;
    return reply.code(200).send({
      sub: user.id,
      email: user.email ?? undefined,
      email_verified: !!user.emailVerifiedAt,
      phone_number: user.phoneE164 ?? undefined,
      phone_number_verified: !!user.phoneVerifiedAt,
      name: user.displayName,
      given_name: user.givenName,
      family_name: user.familyName,
      picture: user.avatarUrl,
      locale: user.locale,
    });
  });

  // ── OIDC Discovery ────────────────────────────────────────────────
  app.get("/.well-known/openid-configuration", async (_request, reply) => {
    return reply.code(200).send(await getOpenIDConfiguration());
  });

  app.get("/.well-known/jwks.json", async (_request, reply) => {
    return reply.code(200).send(await getJWKS());
  });
}
