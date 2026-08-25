/**
 * The signed-qualification boundary, exercised against a RUNNING Brain.
 *
 * WHY THIS EXISTS ALONGSIDE THE UNIT TESTS. The in-process matrix proves the
 * routes classify every failure correctly. This proves the DEPLOYED ARTIFACT
 * does — with the real key from the real EnvironmentFile, the real PostgreSQL
 * replay table, and the real HTTP stack in front of it. The two are not the same
 * claim: the in-process version passed while the service could not boot.
 *
 * IT SIGNS WITH THE DEPLOYED CODE. `signAssertion` is imported from the release
 * under test, not reimplemented here — a second implementation of the canonical
 * form would agree with itself and prove nothing about what the Brain verifies.
 *
 * THE KEY IS READ FROM THE ENVIRONMENT AND NEVER PRINTED. It arrives through the
 * unit's EnvironmentFile; nothing below writes it to output.
 *
 * IT WRITES TO THE DATABASE THE SERVICE IS POINTED AT. The positive control has
 * to: an approval that is not durable is not an approval. Every row it creates
 * names an unmistakable probe model id, and the approval is revoked in the same
 * run, so what remains is an auditable probe → approved → revoked history and no
 * live approval for anything.
 */

import { createHash } from 'node:crypto';

const BASE = process.env.MATRIX_BASE_URL ?? 'http://127.0.0.1:3999';
const RELEASE = process.env.MATRIX_RELEASE_DIR ?? '/opt/migrapilot/brain-service/releases/dff5a96';

const { signAssertion, sha256Hex, ASSERTION_ENVELOPE_VERSION } =
  await import(`${RELEASE}/dist/src/engine/internalAuth/assertion.js`);
const { ACTION_MODELS_QUALIFY, SERVICE_QUALIFICATION_CLI, loadSigningKeys } =
  await import(`${RELEASE}/dist/src/engine/internalAuth/config.js`);

const keys = loadSigningKeys(process.env);
if (keys.size === 0) {
  console.log('FATAL no signing key in the environment — this run would prove nothing');
  process.exit(2);
}
const keyId = [...keys.keys()].sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
const KEY = keys.get(keyId);

const PROBE_MODEL = 'boundary-matrix-probe:not-a-real-model';
const APPROVE = '/api/ai/model-qualification/approve';
const EVIDENCE = '/api/ai/model-qualification/evidence';
const REVOKE = '/api/ai/model-qualification/revoke';

let pass = 0;
let fail = 0;
const record = (name, ok, detail) => {
  if (ok) { pass += 1; console.log(`ok   ${name}`); }
  else { fail += 1; console.log(`FAIL ${name} — ${detail}`); }
};

let counter = 0;
const requestId = (tag) => `matrix-${process.pid}-${(counter += 1)}-${tag}`;

function envelope(over = {}, rawBody = '', path = APPROVE) {
  const now = Date.now();
  return {
    v: ASSERTION_ENVELOPE_VERSION,
    keyId,
    serviceId: SERVICE_QUALIFICATION_CLI,
    approverId: 'user:boundary-matrix',
    action: ACTION_MODELS_QUALIFY,
    method: 'POST',
    path,
    bodyDigest: sha256Hex(rawBody),
    issuedAt: now,
    expiresAt: now + 30_000,
    requestId: requestId(over.tag ?? 'x'),
    ...over,
  };
}

function header(fields, key = KEY) {
  const { tag: _drop, ...clean } = fields;
  const signed = { ...clean, mac: signAssertion(clean, key) };
  return Buffer.from(JSON.stringify(signed), 'utf8').toString('base64');
}

async function post(path, rawBody, assertionHeader) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(assertionHeader === undefined ? {} : { 'x-migrapilot-assertion': assertionHeader }),
    },
    body: rawBody,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Every negative case: what was presented, and the refusal it must draw. */
async function refuses(name, expected, { path = APPROVE, rawBody, hdr }) {
  const out = await post(path, rawBody, hdr);
  record(name, out.body?.error === expected, `expected ${expected}, got ${out.status} ${JSON.stringify(out.body)}`);
}

const approveBody = (evidenceRunId) =>
  JSON.stringify({ modelId: PROBE_MODEL, capability: 'vision', evidenceRunId });

console.log(`# signed-qualification boundary against ${BASE} (key ${keyId})`);

// ── 1. reads are ungated ──────────────────────────────────────────────────
{
  const res = await fetch(`${BASE}/api/ai/model-qualification/vision`);
  record('reads need no assertion', res.status === 200, `got ${res.status}`);
}

// ── 2. every way an assertion can be wrong ────────────────────────────────
const body0 = approveBody('placeholder');

await refuses('no assertion at all', 'malformed', { rawBody: body0, hdr: undefined });
await refuses('undecodable assertion', 'malformed', { rawBody: body0, hdr: 'not-base64-json!!' });
await refuses('unsupported envelope version', 'unsupported_version', {
  rawBody: body0, hdr: header(envelope({ v: ASSERTION_ENVELOPE_VERSION + 1, tag: 'v2' }, body0)),
});
await refuses('unknown key id', 'unknown_key', {
  rawBody: body0, hdr: header(envelope({ keyId: 'v99', tag: 'k99' }, body0)),
});
await refuses('service outside the policy', 'unknown_service', {
  rawBody: body0, hdr: header(envelope({ serviceId: 'some-other-service', tag: 'svc' }, body0)),
});
{
  // A granted service asking for an action it was never granted. Whichever check
  // names it first, both are refusals — neither is a pass.
  const out = await post(APPROVE, body0, header(envelope({ action: 'platform.users.suspend', tag: 'act' }, body0)));
  record('ungranted action', ['action_not_granted', 'wrong_action'].includes(out.body?.error),
    `got ${out.status} ${JSON.stringify(out.body)}`);
}
await refuses('assertion signed for another route', 'request_mismatch', {
  rawBody: body0, hdr: header(envelope({ path: REVOKE, tag: 'path' }, body0, REVOKE)),
});
await refuses('body changed after signing', 'body_mismatch', {
  rawBody: JSON.stringify({ modelId: 'something-else', capability: 'vision', evidenceRunId: 'x' }),
  hdr: header(envelope({ tag: 'body' }, body0)),
});
{
  // The case a digest over a re-serialisation would have accepted.
  const signedBytes = '{"modelId":"a","capability":"vision","evidenceRunId":"b","n":1}';
  const sentBytes = '{"modelId":"a","capability":"vision","evidenceRunId":"b","n":1.0}';
  await refuses('re-serialisation tamper (1.0 → 1)', 'body_mismatch', {
    rawBody: sentBytes, hdr: header(envelope({ tag: 'reser' }, signedBytes)),
  });
  await refuses('whitespace tamper', 'body_mismatch', {
    rawBody: '{"modelId": "a", "capability": "vision", "evidenceRunId": "b", "n": 1}',
    hdr: header(envelope({ tag: 'ws' }, signedBytes)),
  });
}
{
  const now = Date.now();
  await refuses('expired assertion', 'expired', {
    rawBody: body0, hdr: header(envelope({ issuedAt: now - 120_000, expiresAt: now - 60_000, tag: 'exp' }, body0)),
  });
  await refuses('assertion from the future', 'not_yet_valid', {
    rawBody: body0, hdr: header(envelope({ issuedAt: now + 120_000, expiresAt: now + 150_000, tag: 'fut' }, body0)),
  });
  await refuses('validity window beyond the ceiling', 'ttl_too_long', {
    rawBody: body0, hdr: header(envelope({ expiresAt: now + 3_600_000, tag: 'ttl' }, body0)),
  });
}
await refuses('MAC from the wrong key', 'bad_mac', {
  rawBody: body0, hdr: header(envelope({ tag: 'mac' }, body0), 'z'.repeat(128)),
});

// ── 3. the positive control, and what it proves ───────────────────────────
const evidenceBody = JSON.stringify({
  modelId: PROBE_MODEL,
  capability: 'vision',
  suite: 'signed-boundary-matrix',
  passed: true,
  provider: 'local',
  modelVersion: 'probe',
  modelDigest: `sha256:${createHash('sha256').update('boundary-matrix-probe').digest('hex')}`,
  results: { note: 'deployment boundary probe — not a qualification measurement' },
});
const recorded = await post(EVIDENCE, evidenceBody, header(envelope({ tag: 'ev' }, evidenceBody, EVIDENCE), KEY));
record('a correctly signed evidence record is accepted', recorded.status === 201,
  `got ${recorded.status} ${JSON.stringify(recorded.body)}`);
const evidenceRunId = recorded.body?.evidenceRunId;

if (!evidenceRunId) {
  console.log(`\n# ${pass} passed, ${fail} failed — no evidence id, remaining cases skipped`);
  process.exit(1);
}

{
  const res = await fetch(`${BASE}/api/ai/model-qualification/evidence/${evidenceRunId}`);
  const read = await res.json().catch(() => null);
  record('the evidence is durable and readable back', read?.evidence?.modelId === PROBE_MODEL,
    `got ${res.status} ${JSON.stringify(read)}`);
}

const goodBody = approveBody(evidenceRunId);
const replayable = header(envelope({ tag: 'good' }, goodBody));
const approved = await post(APPROVE, goodBody, replayable);
record('a correctly signed approval is accepted', approved.status === 201,
  `got ${approved.status} ${JSON.stringify(approved.body)}`);

// The same assertion again — this is what the durable nonce table is for.
const replayed = await post(APPROVE, goodBody, replayable);
record('a captured valid assertion cannot be used twice', replayed.body?.error === 'replayed',
  `got ${replayed.status} ${JSON.stringify(replayed.body)}`);

// A FRESH, valid assertion for an already-approved model: refused on the merits,
// not on the signature. A valid signature says the caller was permitted to ask.
const duplicate = await post(APPROVE, goodBody, header(envelope({ tag: 'dup' }, goodBody)));
record('a second approval is refused on the merits', duplicate.status === 409,
  `got ${duplicate.status} ${JSON.stringify(duplicate.body)}`);

{
  const res = await fetch(`${BASE}/api/ai/model-qualification/vision`);
  const listed = await res.json().catch(() => null);
  const live = (listed?.approved ?? []).some((a) => a.modelId === PROBE_MODEL);
  record('the approval is live for the capability', live, JSON.stringify(listed));
}

// ── 4. leave nothing approved ─────────────────────────────────────────────
const revokeBody = JSON.stringify({
  modelId: PROBE_MODEL, capability: 'vision', reason: 'deployment boundary probe — never a real qualification',
});
const revoked = await post(REVOKE, revokeBody, header(envelope({ tag: 'rev' }, revokeBody, REVOKE), KEY));
record('the probe approval is revoked', revoked.status === 200 && revoked.body?.revoked === true,
  `got ${revoked.status} ${JSON.stringify(revoked.body)}`);

{
  const res = await fetch(`${BASE}/api/ai/model-qualification/vision`);
  const listed = await res.json().catch(() => null);
  const live = (listed?.approved ?? []).some((a) => a.modelId === PROBE_MODEL);
  record('nothing from this run remains approved', !live, JSON.stringify(listed));
}

// ── 5. a valid signature is not a justification ───────────────────────────
const failedEvidenceBody = JSON.stringify({
  modelId: PROBE_MODEL, capability: 'vision', suite: 'signed-boundary-matrix',
  passed: false, results: { note: 'deliberately failed probe run' },
});
const failedRun = await post(EVIDENCE, failedEvidenceBody,
  header(envelope({ tag: 'evfail' }, failedEvidenceBody, EVIDENCE), KEY));
if (failedRun.status === 201) {
  const body = approveBody(failedRun.body.evidenceRunId);
  const out = await post(APPROVE, body, header(envelope({ tag: 'approvefail' }, body)));
  record('a perfectly signed approval of FAILED evidence is refused', out.body?.error === 'evidence_failed',
    `got ${out.status} ${JSON.stringify(out.body)}`);
} else {
  record('a perfectly signed approval of FAILED evidence is refused', false,
    `could not record the failed run: ${failedRun.status}`);
}

console.log(`\n# ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
