import assert from "node:assert/strict";
import test from "node:test";
import {
  createOAuthClientSchema,
  updateOAuthClientSchema,
} from "../../lib/schemas.js";
import {
  issueClientSecret,
  normalizeClientInput,
  validateScopes,
  verifyRegisteredClientSecret,
} from "./index.js";

test("developer OAuth client input normalizes duplicate boundaries and scopes", () => {
  const normalized = normalizeClientInput({
    clientName: "  MigraMail Web  ",
    description: "  Main web login  ",
    clientType: "web",
    redirectUris: [
      "https://mail.migrateck.com/auth/callback",
      "https://mail.migrateck.com/auth/callback",
      " https://mail.migrateck.com/auth/secondary ",
    ],
    postLogoutRedirectUris: [
      "https://mail.migrateck.com/",
      "https://mail.migrateck.com/",
    ],
    allowedScopes: ["openid", "profile", "openid", "email"],
    requiresPkce: true,
    tokenAuthMethod: "client_secret_basic",
  });

  assert.equal(normalized.clientName, "MigraMail Web");
  assert.equal(normalized.description, "Main web login");
  assert.deepEqual(normalized.redirectUris, [
    "https://mail.migrateck.com/auth/callback",
    "https://mail.migrateck.com/auth/secondary",
  ]);
  assert.deepEqual(normalized.postLogoutRedirectUris, ["https://mail.migrateck.com/"]);
  assert.deepEqual(normalized.allowedScopes, ["openid", "profile", "email"]);
  assert.equal(normalized.requiresPkce, true);
  assert.equal(normalized.tokenAuthMethod, "client_secret_basic");
});

test("confidential client secret verifies against its hash without storing plaintext", () => {
  const issued = issueClientSecret();

  assert.ok(issued.clientSecret.length >= 32);
  assert.notEqual(issued.clientSecret, issued.clientSecretHash);
  assert.equal(
    verifyRegisteredClientSecret(
      { clientSecretHash: issued.clientSecretHash },
      issued.clientSecret,
    ),
    true,
  );
  assert.equal(
    verifyRegisteredClientSecret(
      { clientSecretHash: issued.clientSecretHash },
      "wrong-secret",
    ),
    false,
  );
});

test("scope validation never widens beyond the registered allowlist", () => {
  const client = {
    allowedScopes: ["openid", "profile", "email"],
  } as Parameters<typeof validateScopes>[0];

  assert.deepEqual(
    validateScopes(client, ["openid", "admin:all", "email"]),
    ["openid", "email"],
  );
});

test("OAuth registration schema rejects missing callbacks and invalid auth methods", () => {
  const missingRedirect = createOAuthClientSchema.safeParse({
    client_name: "Broken app",
    client_type: "web",
    redirect_uris: [],
    allowed_scopes: ["openid"],
    token_auth_method: "client_secret_basic",
  });
  assert.equal(missingRedirect.success, false);

  const invalidMethod = createOAuthClientSchema.safeParse({
    client_name: "Broken app",
    client_type: "web",
    redirect_uris: ["https://example.com/callback"],
    allowed_scopes: ["openid"],
    token_auth_method: "password",
  });
  assert.equal(invalidMethod.success, false);
});

test("OAuth update schema does not allow ownership or client type mutation", () => {
  const parsed = updateOAuthClientSchema.parse({
    client_name: "Updated name",
    redirect_uris: ["https://example.com/callback"],
    allowed_scopes: ["openid", "email"],
    requires_pkce: true,
    is_active: true,
  });

  assert.equal(parsed.client_name, "Updated name");
  assert.equal("owner_org_id" in parsed, false);
  assert.equal("client_type" in parsed, false);
  assert.equal("token_auth_method" in parsed, false);
});
