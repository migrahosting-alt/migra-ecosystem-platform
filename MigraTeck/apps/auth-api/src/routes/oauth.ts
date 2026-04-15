/**
 * OAuth 2.1 routes — /authorize, /token, /revoke, /userinfo, OIDC discovery.
 */
import type { FastifyInstance } from "fastify";
import { authorizeQuerySchema, tokenExchangeSchema, revokeSchema } from "../lib/schemas.js";
import { findClientById, isConfidentialClient, validateRedirectUri, validateScopes, verifyRegisteredClientSecret } from "../modules/clients/index.js";
import { createAuthCode, exchangeAuthCode, rotateRefreshToken, revokeRefreshTokenFamily } from "../modules/tokens/index.js";
import { logAuditEvent } from "../modules/audit/index.js";
import { getJWKS, getOpenIDConfiguration } from "../lib/jwt.js";
import { config } from "../config/env.js";
import { requireAuthenticatedUser, requireSession, optionalSession, getClientIp } from "../middleware/session.js";

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
  app.get("/authorize", { preHandler: optionalSession }, async (request, reply) => {
    const query = authorizeQuerySchema.parse(request.query);

    // Validate client
    const client = await findClientById(query.client_id);
    if (!client || !client.isActive) {
      return reply.code(400).send({ error: { code: "invalid_client", message: "Unknown client_id." } });
    }
    if (!validateRedirectUri(client, query.redirect_uri)) {
      return reply.code(400).send({ error: { code: "invalid_redirect_uri", message: "redirect_uri not registered." } });
    }

    // Validate scopes
    const requestedScopes = query.scope ? query.scope.split(" ") : ["openid"];
    const validScopes = validateScopes(client, requestedScopes);

    // If user is already authenticated, issue code immediately (SSO)
    if (request.authUser && request.authUser.status === "ACTIVE") {
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

    // Not authenticated — redirect to auth-web login with all params
    const loginUrl = new URL("/login", config.webUrl);
    loginUrl.searchParams.set("client_id", query.client_id);
    loginUrl.searchParams.set("redirect_uri", query.redirect_uri);
    loginUrl.searchParams.set("state", query.state);
    loginUrl.searchParams.set("code_challenge", query.code_challenge);
    loginUrl.searchParams.set("code_challenge_method", query.code_challenge_method);
    if (query.scope) loginUrl.searchParams.set("scope", query.scope);
    if (query.nonce) loginUrl.searchParams.set("nonce", query.nonce);
    if (query.prompt) loginUrl.searchParams.set("prompt", query.prompt);
    if (query.login_hint) loginUrl.searchParams.set("login_hint", query.login_hint);
    if (query.return_to) loginUrl.searchParams.set("return_to", query.return_to);
    loginUrl.searchParams.set("response_type", "code");

    return reply.redirect(loginUrl.toString());
  });

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
      email: user.email,
      email_verified: !!user.emailVerifiedAt,
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
