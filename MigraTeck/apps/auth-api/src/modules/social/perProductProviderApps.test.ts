/**
 * Per-product external-provider apps.
 *
 * WHAT THIS PROTECTS. Google renders the consent screen of the PROJECT owning
 * the OAuth client — one brand per project — so a single ecosystem-wide Google
 * app makes every product's sign-in say the same name. Eight products were
 * signing in through one client, and MigraPilot's consent screen read "Continue
 * to MigraTeck". Per-product apps are the only fix, and these pin the parts of
 * it that fail silently:
 *
 *   1. A half-configured override must KILL THE PROCESS, not fall back — a
 *      fallback shows the wrong product name while every health check is green.
 *   2. An unmigrated product must keep using the shared credential, untouched.
 *   3. The callback must exchange with the app that ISSUED the code.
 *   4. The product must come from the TRANSACTION, never from the query string.
 *   5. Which providers are OFFERED must not depend on any product.
 */

// Set BEFORE `config` is imported: it reads the environment once, at import.
process.env["AUTH_GOOGLE_CLIENT_ID"] = "shared-ecosystem.apps.googleusercontent.com";
process.env["AUTH_GOOGLE_CLIENT_SECRET"] = "shared-secret";
process.env["AUTH_GOOGLE_CLIENT_ID__MIGRAPILOT_WEB"] = "migrapilot-own.apps.googleusercontent.com";
process.env["AUTH_GOOGLE_CLIENT_SECRET__MIGRAPILOT_WEB"] = "migrapilot-secret";

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { providerEnvSuffix, providerOverrides } = await import("../../config/env.js");
const { resolveConfiguredProvider, availableProviders, hasOwnProviderApp } =
  await import("./providers.js");

const read = (relative: string) => readFileSync(join(process.cwd(), "src", relative), "utf8");

test("the env-var suffix is derived from the client id, not mapped by hand", () => {
  assert.equal(providerEnvSuffix("migrapilot_web"), "MIGRAPILOT_WEB");
  assert.equal(providerEnvSuffix("migrahosting_client_portal"), "MIGRAHOSTING_CLIENT_PORTAL");
  // Derived, so registering a product and configuring its app cannot drift.
  assert.equal(providerEnvSuffix("some-new.product"), "SOME_NEW_PRODUCT");
});

test("a product with its own app signs in through it", () => {
  const resolved = resolveConfiguredProvider("google", "migrapilot_web");
  assert.ok(resolved);
  assert.equal(resolved.credentials.clientId, "migrapilot-own.apps.googleusercontent.com");
  assert.equal(resolved.credentials.clientSecret, "migrapilot-secret");
});

test("an unmigrated product still uses the shared credential", () => {
  /*
   * The load-bearing half of "migrate one product at a time". If this ever
   * stopped falling back, adding MigraPilot's app would break the other seven.
   */
  for (const product of ["migrahosting_web", "migrapanel_web", "migradrive_web"]) {
    const resolved = resolveConfiguredProvider("google", product);
    assert.ok(resolved, `${product} must still resolve`);
    assert.equal(resolved.credentials.clientId, "shared-ecosystem.apps.googleusercontent.com");
  }
});

test("no product at all — MigraAuth's own login — uses the shared credential", () => {
  const resolved = resolveConfiguredProvider("google", null);
  assert.ok(resolved);
  assert.equal(resolved.credentials.clientId, "shared-ecosystem.apps.googleusercontent.com");
});

test("hasOwnProviderApp separates 'shared' from 'its app is gone'", () => {
  assert.equal(hasOwnProviderApp("GOOGLE", "migrapilot_web"), true);
  assert.equal(hasOwnProviderApp("GOOGLE", "migrahosting_web"), false);
  assert.equal(hasOwnProviderApp("GOOGLE", null), false);
});

test("a provider with no per-product app configured is unaffected", () => {
  // GitHub has no overrides here, so every product resolves the same way.
  process.env["AUTH_GITHUB_CLIENT_ID"] = "gh-shared";
  process.env["AUTH_GITHUB_CLIENT_SECRET"] = "gh-secret";
  assert.equal(hasOwnProviderApp("GITHUB", "migrapilot_web"), false);
});

test("which providers are OFFERED does not depend on any product", () => {
  /*
   * availableProviders() must stay a global question. If it ever took a
   * product, configuring an override could silently REMOVE a working button for
   * everyone else.
   */
  const providers = availableProviders();
  assert.ok(providers.some((p) => p.id === "google"), "google must be offered");
  assert.equal(availableProviders.length, 0, "availableProviders must take no arguments");
});

test("a half-configured override refuses to boot", () => {
  const saved = { ...process.env };
  try {
    delete process.env["AUTH_GOOGLE_CLIENT_SECRET__MIGRAPILOT_WEB"];
    assert.throws(
      () => providerOverrides("GOOGLE"),
      /AUTH_GOOGLE_CLIENT_ID__MIGRAPILOT_WEB and AUTH_GOOGLE_CLIENT_SECRET__MIGRAPILOT_WEB must BOTH be set/,
      "an id without its secret must be fatal, never a silent fallback",
    );

    // And the mirror image: a secret with no id is just as wrong.
    process.env["AUTH_GOOGLE_CLIENT_SECRET__MIGRAPILOT_WEB"] = "migrapilot-secret";
    delete process.env["AUTH_GOOGLE_CLIENT_ID__MIGRAPILOT_WEB"];
    assert.throws(() => providerOverrides("GOOGLE"), /must BOTH be set/);
  } finally {
    process.env = saved;
  }
});

test("the callback exchanges with the app that issued the code", () => {
  const social = read("routes/social.ts");

  /*
   * THE INVARIANT THAT SILENTLY BREAKS. An authorization code is bound to the
   * client it was issued to. If the exchange ever reverts to the ambient
   * `credentials`, a product on its own app fails at the exchange with an
   * opaque provider error — and only for that product.
   */
  const start = social.indexOf("const accessToken = await exchangeCode(");
  assert.ok(start > 0, "the exchange must exist");
  const call = social.slice(start, start + 400);
  assert.match(call, /clientId:\s*exchangeCredentials\.clientId/);
  assert.match(call, /clientSecret:\s*exchangeCredentials\.clientSecret/);

  // Resolved from the STATE row, which recorded it when the redirect was built.
  assert.match(social, /resolveConfiguredProvider\(slug,\s*state\.productClientId\)/);
});

test("the product is read from the transaction, never from the query string", () => {
  const social = read("routes/social.ts");
  assert.match(
    social,
    /productClientId = found\.transaction\.clientId/,
    "the product must come from the transaction row",
  );
  /*
   * A caller-supplied product would let anyone choose which brand a person is
   * shown while signing in to something else entirely.
   */
  assert.doesNotMatch(social, /request\.query\.(product|client_id)/);
});

test("the state row carries the product across the round trip", () => {
  const state = read("modules/social/state.ts");
  assert.match(state, /productClientId: input\.productClientId \?\? null/, "written on create");
  assert.match(state, /productClientId: row\.productClientId/, "read back on consume");
});

test("the redirect is built with the product's app", () => {
  const social = read("routes/social.ts");

  // The authorize params still read `credentials`, which is now REASSIGNED to
  // the product's app when there is one. Both halves must stay true together.
  assert.match(social, /client_id:\s*credentials\.clientId/, "authorize sends credentials.clientId");
  assert.match(
    social,
    /if \(forProduct\) credentials = forProduct\.credentials;/,
    "the product's app must replace the shared one before the redirect is built",
  );
  assert.match(social, /let credentials = resolved\.credentials;/, "credentials must be reassignable");
});
