/**
 * The signed boundary, exercised over real HTTP.
 *
 * WHY OVER `inject` AND NOT AGAINST THE VERIFIER DIRECTLY. The unit tests prove
 * `verifyAssertion` classifies each failure correctly. This proves the ROUTES
 * actually consult it, that the content-type parser preserves the bytes the MAC
 * was computed over, and that a refusal reaches the caller as a refusal — the
 * gap between "the check exists" and "the check runs" is where these controls
 * historically fail.
 *
 * Every case below is a way in. The positive control at the end is what makes
 * the negatives meaningful: without it, a route that refused EVERYTHING would
 * pass this file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { PoolClient } from 'pg';

import { registerQualificationRoutes } from '../src/engine/media/qualificationRoutes.js';
import {
  signAssertion, sha256Hex, ASSERTION_ENVELOPE_VERSION, type AssertionFields,
} from '../src/engine/internalAuth/assertion.js';
import { ACTION_MODELS_QUALIFY, SERVICE_QUALIFICATION_CLI } from '../src/engine/internalAuth/config.js';

const KEY = 'k'.repeat(64);
const NOW = 1_700_000_000_000;
const EVIDENCE_ID = 'ev-vision-1';
const DIGEST = 'sha256:' + 'a'.repeat(64);

/**
 * An in-memory stand-in for the two statements these routes issue.
 *
 * The nonce insert reproduces `ON CONFLICT (request_id) DO NOTHING` exactly —
 * first insert reports one row, every repeat reports zero — because that
 * insert-or-fail is the whole replay story and a fake that forgot it would make
 * the replay case pass for the wrong reason.
 */
function fakeStore() {
  const nonces = new Set<string>();
  const decisions: Array<Record<string, unknown>> = [];
  const evidence = new Map<string, Record<string, unknown>>([
    [EVIDENCE_ID, {
      id: EVIDENCE_ID, model_id: 'qwen2.5vl:7b', capability: 'vision',
      model_version: '7b-q4', model_digest: DIGEST, provider: 'local',
      license: 'Apache-2.0', license_source: null, suite: 'vision-battery-v1',
      results_json: {}, environment_json: null, passed: true,
      created_at: NOW, created_by: 'user:seed',
    }],
  ]);

  const client = {
    async query(text: string, params: unknown[] = []) {
      if (text.includes('internal_assertion_nonces')) {
        const id = String(params[0]);
        if (nonces.has(id)) return { rows: [], rowCount: 0 };
        nonces.add(id);
        return { rows: [], rowCount: 1 };
      }
      if (text.startsWith('SELECT * FROM model_evidence_runs')) {
        const row = evidence.get(String(params[0]));
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (text.includes('INSERT INTO model_qualification_decisions')) {
        decisions.push({ id: params[0], modelId: params[1] });
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('INSERT INTO model_evidence_runs')) return { rows: [], rowCount: 1 };
      if (text.startsWith('SELECT') || text.startsWith('UPDATE') || text.startsWith('DELETE')) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`unexpected statement: ${text.slice(0, 60)}`);
    },
  } as unknown as PoolClient;

  return { client, nonces, decisions };
}

async function buildApp(options: { withKey?: boolean } = {}) {
  const store = fakeStore();
  const audits: Array<{ event: string; detail: Record<string, unknown> }> = [];
  const app = Fastify();
  const keys = options.withKey === false ? new Map<string, string>() : new Map([['v1', KEY]]);

  registerQualificationRoutes(app, {
    internalAuth: {
      keys,
      servicePolicy: new Map([[SERVICE_QUALIFICATION_CLI, new Set([ACTION_MODELS_QUALIFY])]]),
      enabled: keys.size > 0,
    },
    transaction: (fn) => fn(store.client),
    audit: (event, detail) => { audits.push({ event, detail }); },
    now: () => NOW,
  });
  await app.ready();
  return { app, audits, store };
}

const APPROVE_PATH = '/api/ai/model-qualification/approve';
const APPROVE_BODY = JSON.stringify({
  modelId: 'qwen2.5vl:7b', capability: 'vision', evidenceRunId: EVIDENCE_ID,
});

function fieldsFor(over: Partial<AssertionFields> = {}, rawBody = APPROVE_BODY): AssertionFields {
  return {
    v: ASSERTION_ENVELOPE_VERSION,
    keyId: 'v1',
    serviceId: SERVICE_QUALIFICATION_CLI,
    approverId: 'user:operator-1',
    action: ACTION_MODELS_QUALIFY,
    method: 'POST',
    path: APPROVE_PATH,
    bodyDigest: sha256Hex(rawBody),
    issuedAt: NOW,
    expiresAt: NOW + 30_000,
    requestId: `req-${Math.floor(NOW)}-${over.requestId ?? 'base'}`,
    ...over,
  };
}

function headerFor(fields: AssertionFields, key = KEY): string {
  const signed = { ...fields, mac: signAssertion(fields, key) };
  return Buffer.from(JSON.stringify(signed), 'utf8').toString('base64');
}

async function post(app: Awaited<ReturnType<typeof buildApp>>['app'], opts: {
  path?: string; header?: string | undefined; body?: string;
}) {
  return app.inject({
    method: 'POST',
    url: opts.path ?? APPROVE_PATH,
    payload: opts.body ?? APPROVE_BODY,
    headers: {
      'content-type': 'application/json',
      ...(opts.header === undefined ? {} : { 'x-migrapilot-assertion': opts.header }),
    },
  });
}

// ── the matrix ────────────────────────────────────────────────────────────

test('1. no assertion at all is refused', async () => {
  const { app, audits } = await buildApp();
  const res = await post(app, { header: undefined });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'malformed');
  assert.equal(audits.at(-1)?.event, 'qualification.denied');
});

test('2. an assertion that is not decodable is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, { header: 'not-base64-json!!' });
  assert.equal(res.json().error, 'malformed');
});

test('3. a different envelope version is refused, never negotiated', async () => {
  const { app } = await buildApp();
  const res = await post(app, { header: headerFor(fieldsFor({ v: 2, requestId: 'v2' })) });
  assert.equal(res.json().error, 'unsupported_version');
});

test('4. a key id this deployment does not hold is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, { header: headerFor(fieldsFor({ keyId: 'v9', requestId: 'k9' })) });
  assert.equal(res.json().error, 'unknown_key');
});

test('5. a service outside the policy is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, { header: headerFor(fieldsFor({ serviceId: 'some-other-service', requestId: 'svc' })) });
  assert.equal(res.json().error, 'unknown_service');
});

test('6. a granted service asking for an action it was not granted is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ action: 'platform.users.suspend', requestId: 'act' })),
  });
  // The route expects one action; a different one it never granted this service
  // fails on whichever check names it first — both are refusals, neither is a pass.
  assert.ok(['action_not_granted', 'wrong_action'].includes(res.json().error), res.body);
  assert.ok(res.statusCode === 403);
});

test('7. an assertion signed for another route cannot be replayed onto this one', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ path: '/api/ai/model-qualification/revoke', requestId: 'path' })),
  });
  assert.equal(res.json().error, 'request_mismatch');
});

test('8. a body changed after signing is refused', async () => {
  const { app } = await buildApp();
  const tampered = JSON.stringify({ modelId: 'llava:latest', capability: 'vision', evidenceRunId: EVIDENCE_ID });
  const res = await post(app, { header: headerFor(fieldsFor({ requestId: 'body' })), body: tampered });
  assert.equal(res.json().error, 'body_mismatch');
});

test('9. a body that RE-SERIALISES identically is still refused', async () => {
  /*
   * THE CASE THE OLD FALLBACK LET THROUGH. `{"n":1.0}` parses and re-stringifies
   * to `{"n":1}`, so a digest taken over a reconstruction would have matched a
   * body that was altered in flight. Over the raw bytes it cannot.
   */
  const { app } = await buildApp();
  const signedBytes = '{"modelId":"qwen2.5vl:7b","capability":"vision","evidenceRunId":"ev-vision-1","n":1}';
  const sentBytes = '{"modelId":"qwen2.5vl:7b","capability":"vision","evidenceRunId":"ev-vision-1","n":1.0}';
  assert.equal(JSON.stringify(JSON.parse(sentBytes)), signedBytes, 'the two are indistinguishable once parsed');

  const fields = fieldsFor({ requestId: 'reserialise' }, signedBytes);
  const res = await post(app, { header: headerFor(fields), body: sentBytes });
  assert.equal(res.json().error, 'body_mismatch');
});

test('10. an expired assertion is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ issuedAt: NOW - 120_000, expiresAt: NOW - 60_000, requestId: 'exp' })),
  });
  assert.equal(res.json().error, 'expired');
});

test('11. an assertion from the future beyond clock skew is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ issuedAt: NOW + 60_000, expiresAt: NOW + 90_000, requestId: 'future' })),
  });
  assert.equal(res.json().error, 'not_yet_valid');
});

test('12. a long-lived assertion is refused — it would be a standing credential', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ expiresAt: NOW + 3_600_000, requestId: 'ttl' })),
  });
  assert.equal(res.json().error, 'ttl_too_long');
});

test('13. a MAC from the wrong key is refused', async () => {
  const { app } = await buildApp();
  const res = await post(app, {
    header: headerFor(fieldsFor({ requestId: 'mac' }), 'x'.repeat(64)),
  });
  assert.equal(res.json().error, 'bad_mac');
});

test('14. a captured VALID assertion cannot be used twice', async () => {
  const { app } = await buildApp();
  const header = headerFor(fieldsFor({ requestId: 'replay-once' }));

  const first = await post(app, { header });
  assert.equal(first.statusCode, 201, first.body);

  const second = await post(app, { header });
  assert.equal(second.statusCode, 409);
  assert.equal(second.json().error, 'replayed');
});

// ── controls ──────────────────────────────────────────────────────────────

test('positive control: a correctly signed request is accepted and recorded', async () => {
  const { app, store, audits } = await buildApp();
  const res = await post(app, { header: headerFor(fieldsFor({ requestId: 'good' })) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().state, 'approved');
  assert.equal(store.decisions.length, 1);

  const approved = audits.find((a) => a.event === 'qualification.approved');
  assert.ok(approved, 'an approval must leave a record');
  assert.equal(approved.detail.approver, 'user:operator-1');
  assert.equal(approved.detail.modelDigest, DIGEST, 'the recorded decision names the exact bytes');
});

test('a deployment with no signing key cannot qualify anything, correctly signed or not', async () => {
  const { app } = await buildApp({ withKey: false });
  const res = await post(app, { header: headerFor(fieldsFor({ requestId: 'nokey' })) });
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'signing_not_configured');
});

test('reads need no assertion — looking something up is not a privilege', async () => {
  const { app } = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/ai/model-qualification/vision' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { capability: 'vision', approved: [] });

  const one = await app.inject({ method: 'GET', url: `/api/ai/model-qualification/evidence/${EVIDENCE_ID}` });
  assert.equal(one.statusCode, 200);
  assert.equal(one.json().evidence.modelDigest, DIGEST);
});

test('a signed request pointing at evidence that did not pass is still refused', async () => {
  /*
   * A valid signature says the CALLER was permitted to ask. It says nothing
   * about whether the thing being asked for is justified, and conflating the two
   * is how a governance layer becomes a rubber stamp.
   */
  const { app, store } = await buildApp();
  store.client.query = (async (text: string, params: unknown[] = []) => {
    if (text.startsWith('SELECT * FROM model_evidence_runs')) {
      return { rows: [{
        id: EVIDENCE_ID, model_id: 'qwen2.5vl:7b', capability: 'vision', provider: 'local',
        suite: 'vision-battery-v1', results_json: {}, passed: false, created_at: NOW,
      }], rowCount: 1 };
    }
    if (text.includes('internal_assertion_nonces')) return { rows: [], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }) as PoolClient['query'];

  const res = await post(app, { header: headerFor(fieldsFor({ requestId: 'failed-evidence' })) });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, 'evidence_failed');
});

test('a rejected attempt records the claim and never the proof', async () => {
  const { app, audits } = await buildApp();
  const wrongKey = 'x'.repeat(64);
  const fields = fieldsFor({ requestId: 'forge' });
  const forgedMac = signAssertion(fields, wrongKey);
  await post(app, { header: headerFor(fields, wrongKey) });

  const denial = audits.find((a) => a.event === 'qualification.denied');
  assert.ok(denial);
  assert.equal(denial.detail.reason, 'bad_mac');
  assert.equal(denial.detail.claimedApprover, 'user:operator-1');
  assert.equal(denial.detail.claimedService, SERVICE_QUALIFICATION_CLI);

  /*
   * Asserted against the MAC's VALUE, not the word. The first version of this
   * checked for the substring 'mac' and failed on its own `reason: 'bad_mac'` —
   * a test matching text it wrote itself proves nothing about the data.
   */
  const serialised = JSON.stringify(denial.detail);
  assert.ok(!serialised.includes(forgedMac), 'the forged MAC must not be written down');
  assert.ok(!serialised.includes(KEY), 'nor anything derived from the real key');
});
