/**
 * Signed service-to-service assertions.
 *
 * The Brain has no human authentication, so this is the whole difference between
 * "an authenticated operator approved a model" and "some process on the box said
 * so". Every rejection below is a way the second could masquerade as the first.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import {
  verifyAssertion, signAssertion, canonicalString, sha256Hex,
  MAX_ASSERTION_TTL_MS, CLOCK_SKEW_MS, ASSERTION_ENVELOPE_VERSION,
  type AssertionFields, type VerifyDeps,
} from '../src/engine/internalAuth/assertion.js';

const KEY = 'k'.repeat(64);
const OLD_KEY = 'o'.repeat(64);
const ACTION = 'platform.models.qualify';
const BODY = JSON.stringify({ modelId: 'qwen2.5vl:7b', capability: 'vision' });

function depsWith(seen = new Set<string>()): VerifyDeps {
  return {
    keys: new Map([['v1', KEY], ['v2', OLD_KEY]]),
    servicePolicy: new Map([['migrapilot-command-center', new Set([ACTION])]]),
    rememberRequestId: async (id) => (seen.has(id) ? false : (seen.add(id), true)),
  };
}

function fieldsFor(over: Partial<AssertionFields> = {}, now = Date.now()): AssertionFields {
  return {
    v: 1,
    keyId: 'v1',
    serviceId: 'migrapilot-command-center',
    approverId: 'user:4fe95869',
    action: ACTION,
    method: 'POST',
    path: '/api/ai/model-qualification/approve',
    bodyDigest: sha256Hex(BODY),
    issuedAt: now,
    expiresAt: now + 30_000,
    requestId: randomUUID(),
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof verifyAssertion>[1]> = {}) => ({
  expectedAction: ACTION,
  method: 'POST',
  path: '/api/ai/model-qualification/approve',
  rawBody: BODY,
  ...over,
});

const signed = (f: AssertionFields, key = KEY) => ({ ...f, mac: signAssertion(f, key) });

test('a correctly signed, fresh assertion verifies', async () => {
  const f = fieldsFor();
  const out = await verifyAssertion(signed(f), ctx(), depsWith());
  assert.equal(out.ok, true);
  if (out.ok) {
    assert.equal(out.assertion.approverId, 'user:4fe95869');
    assert.equal(out.assertion.serviceId, 'migrapilot-command-center');
  }
});

test('the canonical form is unambiguous across field boundaries', async () => {
  /*
   * Delimiter-joining makes ("a","b:c") and ("a:b","c") identical, so two
   * different requests could share one MAC. Length prefixing removes that
   * rather than trusting fields never to contain the delimiter.
   */
  const a = canonicalString(fieldsFor({ approverId: 'user:a', action: 'b.c' }));
  const b = canonicalString(fieldsFor({ approverId: 'user:a:b', action: 'c' }));
  assert.notEqual(a, b);
});

test('a signature minted for another action cannot authorize this one', async () => {
  /*
   * The route's requirement wins over the assertion's claim. Otherwise a
   * signature for something harmless verifies perfectly and proves the wrong
   * thing.
   */
  const f = fieldsFor({ action: 'platform.models.read' });
  const out = await verifyAssertion(signed(f), ctx(), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'wrong_action');
});

test('a body swapped after signing is refused', async () => {
  const f = fieldsFor();
  const out = await verifyAssertion(signed(f), ctx({ rawBody: JSON.stringify({ modelId: 'something-else' }) }), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'body_mismatch');
});

test('an assertion for a different route is refused', async () => {
  const f = fieldsFor();
  for (const over of [{ method: 'DELETE' }, { path: '/api/ai/model-qualification/revoke' }]) {
    const out = await verifyAssertion(signed(f), ctx(over), depsWith());
    assert.equal(out.ok, false);
    if (!out.ok) assert.equal(out.reason, 'request_mismatch');
  }
});

test('a tampered field breaks the signature', async () => {
  const f = fieldsFor();
  const s = signed(f);
  const out = await verifyAssertion({ ...s, approverId: 'user:someone-else' }, ctx(), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'bad_mac');
});

test('a key the Brain does not hold is refused, never guessed', async () => {
  const f = fieldsFor({ keyId: 'v9' });
  const out = await verifyAssertion(signed(f), ctx(), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'unknown_key');
});

test('versioned keys allow rotation without a coordinated cutover', async () => {
  /*
   * Both keys active at once is the whole point: add the new key to both sides,
   * switch the signer, retire the old one — no window where one service can talk
   * and the other cannot.
   */
  const older = fieldsFor({ keyId: 'v2' });
  const out = await verifyAssertion(signed(older, OLD_KEY), ctx(), depsWith());
  assert.equal(out.ok, true);
});

test('an unlisted service cannot make privileged calls', async () => {
  const f = fieldsFor({ serviceId: 'some-other-service' });
  const out = await verifyAssertion(signed(f), ctx(), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'unknown_service');
});

test('expiry, future-dating and over-long TTLs are all refused', async () => {
  const now = Date.now();

  const expired = fieldsFor({ issuedAt: now - 120_000, expiresAt: now - 60_000 }, now);
  let out = await verifyAssertion(signed(expired), ctx({ now }), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'expired');

  const future = fieldsFor({ issuedAt: now + 60_000, expiresAt: now + 80_000 }, now);
  out = await verifyAssertion(signed(future), ctx({ now }), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'not_yet_valid');

  /* A long-lived privileged assertion is a standing credential in transit. */
  const longLived = fieldsFor({ issuedAt: now, expiresAt: now + MAX_ASSERTION_TTL_MS + 1 }, now);
  out = await verifyAssertion(signed(longLived), ctx({ now }), depsWith());
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'ttl_too_long');
});

test('small clock drift between two services is tolerated', async () => {
  const now = Date.now();
  const slightlyAhead = fieldsFor({ issuedAt: now + CLOCK_SKEW_MS - 500, expiresAt: now + 30_000 }, now);
  const out = await verifyAssertion(signed(slightlyAhead), ctx({ now }), depsWith());
  assert.equal(out.ok, true);
});

test('a request id may be used exactly once', async () => {
  const deps = depsWith();
  const f = fieldsFor();
  assert.equal((await verifyAssertion(signed(f), ctx(), deps)).ok, true);
  const replay = await verifyAssertion(signed(f), ctx(), deps);
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.reason, 'replayed');
});

test('a nonce is NOT spent by an assertion that fails to verify', async () => {
  /*
   * Otherwise anyone can burn arbitrary request ids with junk signatures and
   * block the real operator's next call — replay protection turned into a denial
   * of service.
   */
  const seen = new Set<string>();
  const deps = depsWith(seen);
  const f = fieldsFor();
  const forged = { ...f, mac: 'f'.repeat(64) };

  const bad = await verifyAssertion(forged, ctx(), deps);
  assert.equal(bad.ok, false);
  assert.equal(seen.size, 0, 'a failed verification must not consume the nonce');

  // The genuine request with the same id still works.
  assert.equal((await verifyAssertion(signed(f), ctx(), deps)).ok, true);
});

test('malformed input is refused before any crypto is attempted', async () => {
  const deps = depsWith();
  for (const bad of [
    null, undefined, 'a string', 42,
    { ...fieldsFor(), mac: 'not-hex' },
    { ...fieldsFor(), bodyDigest: 'short' },
    { ...fieldsFor(), issuedAt: 1.5 },
    { ...fieldsFor(), requestId: 'has spaces and\nnewlines' },
    { ...fieldsFor(), serviceId: '' },
  ]) {
    const out = await verifyAssertion(bad, ctx(), deps);
    assert.equal(out.ok, false, `${JSON.stringify(bad)?.slice(0, 40)} must be refused`);
  }
});

test('an empty or absent mac never verifies', async () => {
  const f = fieldsFor();
  for (const mac of ['', '0'.repeat(64)]) {
    const out = await verifyAssertion({ ...f, mac }, ctx(), depsWith());
    assert.equal(out.ok, false);
  }
});

test('a valid key does not make a caller universally privileged', async () => {
  /*
   * The key proves WHO is calling; the policy decides WHAT they may ask for. A
   * key leaked from a service that may only qualify models must not become the
   * power to do everything else the Brain will ever expose.
   */
  const deps: VerifyDeps = {
    keys: new Map([['v1', KEY]]),
    servicePolicy: new Map([['migrapilot-command-center', new Set(['platform.models.qualify'])]]),
    rememberRequestId: async () => true,
  };
  const other = 'platform.models.delete';
  const f = fieldsFor({ action: other });
  const out = await verifyAssertion(signed(f), ctx({ expectedAction: other }), deps);
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'action_not_granted');
});

test('the envelope version is signed, so it cannot be stripped or downgraded', async () => {
  const f = fieldsFor();
  const s = signed(f);

  /* Rewriting the version breaks the MAC, because it is inside it. */
  const downgraded = await verifyAssertion({ ...s, v: 0 }, ctx(), depsWith());
  assert.equal(downgraded.ok, false);
  if (!downgraded.ok) assert.equal(downgraded.reason, 'unsupported_version');

  /* A future version is refused rather than parsed with today's field rules —
   * validating v2 fields with v1 rules gives a confident answer about the wrong
   * protocol. */
  const future = await verifyAssertion({ ...s, v: 2 }, ctx(), depsWith());
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.reason, 'unsupported_version');

  const missing = await verifyAssertion({ ...s, v: undefined }, ctx(), depsWith());
  assert.equal(missing.ok, false);

  assert.equal(ASSERTION_ENVELOPE_VERSION, 1);
});
