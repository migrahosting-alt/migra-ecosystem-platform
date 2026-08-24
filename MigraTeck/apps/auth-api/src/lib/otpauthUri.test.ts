/**
 * The otpauth URI an authenticator app parses.
 *
 * This is worth pinning because the failure is invisible from the server side:
 * MigraAuth returns a 200 with a perfectly well-formed-looking string, and the
 * damage only appears inside someone's authenticator app — as the wrong product
 * name, a duplicate entry, or a refused scan.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildOtpauthUri } from "../modules/mfa/index.js";

const build = (issuer: string, account = "person@example.test") =>
  buildOtpauthUri({ issuer, account, base32Secret: "JBSWY3DPEHPK3PXP", digits: 6, period: 30 });

test("the label prefix and the issuer parameter are the same value", () => {
  /*
   * THE ONE THAT MATTERS. The spec carries the issuer twice, and authenticators
   * compare them: a mismatch is treated as a different account, so some apps
   * create a duplicate entry and others refuse the scan outright. The regression
   * this guards is someone changing one occurrence and not the other.
   */
  const uri = new URL(build("MigraPilot"));
  const label = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  const [labelIssuer] = label.split(":");

  assert.equal(labelIssuer, "MigraPilot");
  assert.equal(uri.searchParams.get("issuer"), "MigraPilot");
  assert.equal(labelIssuer, uri.searchParams.get("issuer"));
});

test("the account is identifiable inside the label", () => {
  const label = decodeURIComponent(new URL(build("MigraPilot")).pathname.replace(/^\/+/, ""));
  assert.equal(label, "MigraPilot:person@example.test");
});

test("a product name with a space produces a valid URI", () => {
  /*
   * The previous implementation interpolated a bare constant into a template
   * string. That was safe only because "MigraTeck" happens to contain nothing
   * requiring encoding — the first product named with a space would have emitted
   * a URI with a literal space in it.
   */
  const raw = build("MigraAI Studio");
  assert.ok(!raw.includes(" "), "no unencoded space may survive into the URI");

  const uri = new URL(raw);
  const label = decodeURIComponent(uri.pathname.replace(/^\/+/, ""));
  assert.equal(label.split(":")[0], "MigraAI Studio");
  assert.equal(uri.searchParams.get("issuer"), "MigraAI Studio");
});

test("the TOTP parameters are unchanged", () => {
  // Branding must not have moved anything the algorithm depends on: a changed
  // digit count or period silently invalidates every code the app generates.
  const uri = new URL(build("MigraPilot"));
  assert.equal(uri.searchParams.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  assert.equal(uri.searchParams.get("digits"), "6");
  assert.equal(uri.searchParams.get("period"), "30");
  assert.equal(uri.protocol, "otpauth:");
  assert.equal(uri.host, "totp");
});
