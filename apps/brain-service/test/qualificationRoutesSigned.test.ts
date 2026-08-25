/**
 * Governed qualification over HTTP.
 *
 * THE RULE THIS FILE EXISTS FOR: there is no unsigned mutation path. One
 * "temporary" maintenance route that skips the verifier makes every other
 * control decorative, and it is the one still there in a year.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadSigningKeys, loadInternalAuthConfig, SERVICE_QUALIFICATION_CLI, ACTION_MODELS_QUALIFY } from '../src/engine/internalAuth/config.js';

const routesSource = readFileSync(
  join(process.cwd(), 'src', 'engine', 'media', 'qualificationRoutes.ts'), 'utf8',
);
const code = routesSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every mutating route requires an assertion; reads do not', () => {
  /*
   * Asserted over the SOURCE because the property is structural: it is about
   * which routes exist, not about how one of them behaves. A new write route
   * added without the guard is the failure being prevented.
   *
   * MATCHED ON ANY RECEIVER, not on the name `app`. The routes moved into an
   * encapsulated scope, and a gate that keyed on the old variable name would
   * have found zero routes and reported the file clean.
   */
  const writes = [...code.matchAll(/\w+\.post(?:<[^>]*>)?\(\s*'([^']+)'/g)].map((m) => m[1]!);
  assert.ok(writes.length >= 3, `expected the mutation routes, found ${writes.length}`);

  for (const path of writes) {
    const at = code.indexOf(`'${path}'`);
    const body = code.slice(at, at + 700);
    assert.match(body, /await requireAssertion\(/, `${path} must verify a signed assertion`);
    assert.match(body, /if \(!assertion\) return reply/, `${path} must stop when verification fails`);
  }

  // Reads are ordinary: gating them would only make the router's own lookups awkward.
  const reads = [...code.matchAll(/\w+\.get(?:<[^>]*>)?\(\s*'([^']+)'/g)].map((m) => m[1]!);
  assert.ok(reads.length >= 2);
});

test('the signed body is compared byte-for-byte, with no reconstruction path', () => {
  /*
   * `req.rawBody` was documented as the digest input and nothing populated it,
   * so verification silently fell through to `JSON.stringify(req.body)`. That
   * compares a RE-SERIALISATION: `{"n":1.0}` becomes `{"n":1}`, so a body could
   * be altered in flight and still satisfy a MAC computed over the original.
   */
  const parserSource = readFileSync(join(process.cwd(), 'src', 'http', 'jsonBodyParser.ts'), 'utf8');
  assert.match(parserSource, /rawBody\s*=\s*text/, 'the service parser must keep the exact bytes');

  assert.doesNotMatch(
    code, /rawBody[^\n]*JSON\.stringify\(req\.body/,
    'a fallback to re-serialising the parsed body is the defect, not a safety net',
  );
  assert.match(code, /raw_body_unavailable/, 'missing raw bytes must refuse, not degrade');

  /*
   * AND NOT BY ADDING A SECOND PARSER. These routes first captured the bytes in
   * their own `application/json` parser, which Fastify refuses once the service
   * has installed one — FST_ERR_CTP_ALREADY_PRESENT, at startup, on the host.
   */
  assert.doesNotMatch(code, /addContentTypeParser/, 'the capture belongs to the one parser the service installs');
});

test('no mutation reaches the store outside a verified handler', () => {
  /*
   * The store functions that WRITE must appear only after an assertion has been
   * checked. This catches a helper that calls insertDecision directly.
   */
  for (const writer of ['insertDecision(', 'insertEvidenceRun(', 'revokeApproval(']) {
    let index = code.indexOf(writer);
    while (index !== -1) {
      const preceding = code.slice(Math.max(0, index - 2500), index);
      assert.match(preceding, /requireAssertion\(/, `${writer} must be reachable only after verification`);
      index = code.indexOf(writer, index + 1);
    }
  }
});

test('a deployment without a signing key cannot qualify anything', () => {
  /*
   * No key means privileged mutation is IMPOSSIBLE, not unchecked. The opposite
   * default — "no key configured, so skip the check" — is how a gate becomes
   * optional in exactly the environment that most needs it.
   */
  const config = loadInternalAuthConfig({});
  assert.equal(config.enabled, false);
  assert.match(code, /if \(!deps\.internalAuth\.enabled\)/);
  assert.match(code, /signing_not_configured/);
});

test('a key that is really a password is refused, not warned about', () => {
  const short = loadSigningKeys({ MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1: 'hunter2' });
  assert.equal(short.size, 0, 'a MAC key that is really a password is a MAC in name only');

  const good = loadSigningKeys({ MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1: 'a'.repeat(64) });
  assert.equal(good.get('v1'), 'a'.repeat(64));
});

test('keys are versioned, and several may be active for rotation', () => {
  const keys = loadSigningKeys({
    MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1: 'a'.repeat(64),
    MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V2: 'b'.repeat(64),
    MIGRAPILOT_UNRELATED_SECRET: 'c'.repeat(64),
  });
  assert.deepEqual([...keys.keys()].sort(), ['v1', 'v2']);
  assert.ok(!keys.has('unrelated'), 'only qualification keys load into this key set');
});

test('the CLI identity may do exactly one thing', () => {
  /*
   * A future Command Center performs the same operation and must still get its
   * own identity and key: when one is compromised the blast radius should be one
   * caller and the revocation should be one key.
   */
  const config = loadInternalAuthConfig({ MIGRAPILOT_QUALIFICATION_SIGNING_KEY_V1: 'a'.repeat(64) });
  const granted = config.servicePolicy.get(SERVICE_QUALIFICATION_CLI);
  assert.deepEqual([...granted!], [ACTION_MODELS_QUALIFY]);
  assert.equal(config.servicePolicy.size, 1, 'no other service is privileged yet');
});

test('rejected assertions log the claim, never the proof', () => {
  /*
   * An investigation needs the reason and the claimed identity. It does not need
   * the MAC, and logging a rejected forgery in a form that helps the next attempt
   * would be worse than not logging it.
   */
  /* There are several `qualification.denied` audits; this is the one that
   * reports a FAILED ASSERTION, which is the sensitive one. */
  const at = code.indexOf('reason: outcome.reason');
  assert.ok(at > 0, 'the assertion-failure audit must exist');
  const denial = code.slice(at - 200, at + 500);
  assert.match(denial, /reason: outcome\.reason/);
  assert.match(denial, /claimedService/);
  assert.doesNotMatch(denial, /\bmac\b/i, 'the signature must never be logged');
  assert.doesNotMatch(code, /audit\([^)]*keys/i, 'key material must never be logged');
});

test('approval requires evidence that exists, matches, and passed', () => {
  /*
   * An approval pointing at nothing, at another model, or at a failed run is the
   * same hand-wave the JSON file allowed, wearing a foreign key.
   */
  assert.match(code, /unknown_evidence/);
  assert.match(code, /evidence_mismatch/);
  assert.match(code, /evidence_failed/);
  assert.match(code, /if \(!evidence\.passed\)/);
});

test('the digest signed over is the RAW body', () => {
  /*
   * Re-serialising a parsed object compares a reconstruction: key order or number
   * formatting could differ without anyone touching the request.
   */
  assert.match(code, /req\.rawBody/);
});
