import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideToolInvocation,
  provenanceOf,
  type ToolDecisionInput,
} from '../src/engine/tools/toolDecision.js';

/**
 * THE FOUR INVARIANTS, as properties of a value rather than behaviour of a system.
 *
 *   registered  never implies  available
 *   available   never implies  authorized
 *   authorized  never implies  consented
 *   consented   never implies  succeeded
 *
 * Each one is a place where a layer could quietly answer another layer's
 * question. They are asserted directly, because "we were careful" is not a
 * guarantee and the whole point of the split is that it survives people who did
 * not read the design.
 */

const base: ToolDecisionInput = {
  capability: 'Gmail',
  toolId: 'gmail.send',
  registered: true,
  grantHeld: true,
  backendAvailable: true,
  connection: 'connected',
  userAuthorized: true,
  authorizationBasis: 'workspace-member',
  // Declared explicitly: `not_run` is a fault, not a default, so every fixture
  // that expects to reach a later gate has to say preflight actually happened.
  preflight: { state: 'passed' },
  mutating: false,
};

const at = (over: Partial<ToolDecisionInput>) => decideToolInvocation({ ...base, ...over });

test('🚨 registered never implies available', () => {
  const noGrant = at({ grantHeld: false });
  assert.equal(noGrant.registered, true);
  assert.equal(noGrant.platformAvailable, false);
  assert.equal(noGrant.executable, false);
  assert.equal(noGrant.blockedAt, 'registry:no-grant');

  const noBackend = at({ backendAvailable: false });
  assert.equal(noBackend.registered, true);
  assert.equal(noBackend.platformAvailable, false);
  assert.equal(noBackend.blockedAt, 'registry:backend-unavailable');
});

test('🚨 available never implies authorized', () => {
  const d = at({ userAuthorized: false });
  assert.equal(d.platformAvailable, true, 'the platform is fine');
  assert.equal(d.userAuthorized, false);
  assert.equal(d.executable, false);
  assert.equal(d.blockedAt, 'authorization:denied');
});

test('🚨 authorized never implies consented', () => {
  const d = at({ mutating: true, inputHash: 'h1' });
  assert.equal(d.userAuthorized, true);
  assert.equal(d.requiresConsent, true);
  assert.equal(d.consentState, 'absent');
  assert.equal(d.executable, false);
  assert.equal(d.blockedAt, 'consent:required');
});

test('🚨 consented never implies succeeded', () => {
  // `executable` means MAY BE ATTEMPTED. A decision object that pre-declares
  // success is exactly how "consented" becomes "succeeded".
  const d = at({ mutating: true, inputHash: 'h1', consent: { state: 'valid', inputHash: 'h1', approvalId: 'a1' } });
  assert.equal(d.executable, true);
  assert.equal(provenanceOf(d, 'inv-1').outcome, 'attempted');
  assert.ok(!('succeeded' in d), 'the decision must not carry a success field');
});

test('exactly ONE layer is named as the blocker', () => {
  // Everything is wrong at once; the FIRST authority in the chain reports, so a
  // UI never has to guess which failure to show.
  const d = decideToolInvocation({
    ...base,
    registered: false,
    grantHeld: false,
    backendAvailable: false,
    connection: 'not_connected',
    userAuthorized: false,
    mutating: true,
  });
  assert.equal(d.blockedAt, 'registry:unknown');
  assert.equal(d.executable, false);
});

test('the order is registry → connection → authorization → consent', () => {
  const seen: string[] = [];
  let input: ToolDecisionInput = {
    ...base,
    registered: false,
    grantHeld: false,
    backendAvailable: false,
    connection: 'not_connected',
    userAuthorized: false,
    preflight: { state: 'passed' },
    mutating: true,
    inputHash: 'h1',
  };
  // Fix each layer in turn; the reported blocker must walk down the chain.
  seen.push(decideToolInvocation(input).blockedAt!);
  input = { ...input, registered: true };
  seen.push(decideToolInvocation(input).blockedAt!);
  input = { ...input, grantHeld: true };
  seen.push(decideToolInvocation(input).blockedAt!);
  input = { ...input, backendAvailable: true };
  seen.push(decideToolInvocation(input).blockedAt!);
  input = { ...input, connection: 'connected' };
  seen.push(decideToolInvocation(input).blockedAt!);
  input = { ...input, userAuthorized: true };
  seen.push(decideToolInvocation(input).blockedAt!);

  assert.deepEqual(seen, [
    'registry:unknown',
    'registry:no-grant',
    'registry:backend-unavailable',
    'connection:not-connected',
    'authorization:denied',
    'consent:required',
  ]);
});

test('🚨 "not connected" is neither unavailable nor unauthorized', () => {
  /*
   * Gmail registered, granted, healthy, and the user allowed — they have simply
   * never linked an account. Rendering that as "Unavailable" blames the platform
   * and rendering it as "Unauthorized" blames the user; both are false and
   * neither offers a way forward.
   */
  const d = at({ connection: 'not_connected' });
  assert.equal(d.platformAvailable, true, 'the platform IS available');
  assert.equal(d.userAuthorized, true, 'the user IS authorized');
  assert.equal(d.blockedAt, 'connection:not-connected');
  assert.equal(d.action, 'connect');
  assert.match(d.reason!, /Connect your account/);
  assert.ok(!/unavailable|not have access/i.test(d.reason!), d.reason);
});

test('a tool with nothing to connect never shows a Connect action', () => {
  // The negative half: `not_required` must not be read as "not connected".
  const d = at({ connection: 'not_required' });
  assert.equal(d.executable, true);
  assert.equal(d.action, undefined);
});

test('read-only tools take no consent path', () => {
  const d = at({ mutating: false });
  assert.equal(d.requiresConsent, false);
  assert.equal(d.consentState, 'not_required');
  assert.equal(d.executable, true);
});

test('🚨 consent is bound to the EXACT input', () => {
  /*
   * The recipient, amount, path, branch, command or payload changed after the
   * user said yes. The approval is not weaker — it is an approval for something
   * that is no longer what will run.
   */
  const d = at({
    mutating: true,
    inputHash: 'CHANGED',
    consent: { state: 'valid', inputHash: 'h1', approvalId: 'a1' },
  });
  assert.equal(d.executable, false);
  assert.equal(d.consentState, 'mismatched');
  assert.equal(d.blockedAt, 'consent:invalid');
  assert.match(d.reason!, /changed since you approved/);
});

test('a valid approval with no hash recorded is not honoured', () => {
  // Unbound consent is how an approval for one action authorises another.
  const d = at({ mutating: true, inputHash: 'h1', consent: { state: 'valid', approvalId: 'a1' } });
  assert.equal(d.executable, false);
  assert.equal(d.consentState, 'mismatched');
});

test('expired and consumed approvals are refused, and say which', () => {
  const expired = at({ mutating: true, inputHash: 'h1', consent: { state: 'expired', inputHash: 'h1' } });
  assert.equal(expired.executable, false);
  assert.match(expired.reason!, /expired/);

  const consumed = at({ mutating: true, inputHash: 'h1', consent: { state: 'consumed', inputHash: 'h1' } });
  assert.equal(consumed.executable, false);
  assert.match(consumed.reason!, /already used/);
  // Replay and expiry are different facts and must not collapse into one message.
  assert.notEqual(expired.reason, consumed.reason);
});

test('every refusal offers an action the user can take, or admits there is none', () => {
  const cases: Array<[Partial<ToolDecisionInput>, string | undefined]> = [
    [{ registered: false }, undefined], // nothing the user can do
    [{ grantHeld: false }, undefined], // a platform decision
    [{ backendAvailable: false }, 'retry-later'],
    [{ connection: 'not_connected' }, 'connect'],
    [{ userAuthorized: false }, 'request-access'],
    [{ mutating: true, inputHash: 'h1' }, 'consent'],
  ];
  for (const [over, action] of cases) {
    const d = at(over);
    assert.equal(d.executable, false);
    assert.equal(d.action, action, `${JSON.stringify(over)} -> ${d.action}`);
    assert.ok(d.reason && d.reason.length > 10, 'a refusal must say why');
  }
});

test('no reason leaks an internal identifier', () => {
  // The same rule the model picker had to learn: users read these.
  const ids = /\b[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\b/;
  for (const over of [
    { registered: false },
    { grantHeld: false },
    { backendAvailable: false },
    { connection: 'not_connected' as const },
    { userAuthorized: false },
    { mutating: true, inputHash: 'h1' },
  ]) {
    const d = at(over);
    assert.ok(!ids.test(d.reason!), `leaked an identifier: ${d.reason}`);
  }
});

test('provenance carries every field an audit needs', () => {
  const d = at({ mutating: true, inputHash: 'h1', consent: { state: 'valid', inputHash: 'h1', approvalId: 'a1' } });
  const p = provenanceOf(d, 'inv-42', () => 1_700_000_000_000);
  assert.equal(p.capability, 'Gmail');
  assert.equal(p.toolId, 'gmail.send');
  assert.equal(p.authorizationBasis, 'workspace-member');
  assert.equal(p.approvalId, 'a1');
  assert.equal(p.inputHash, 'h1');
  assert.equal(p.invocationId, 'inv-42');
  assert.equal(p.decidedAt, '2023-11-14T22:13:20.000Z');
  assert.equal(p.outcome, 'attempted');
});

test('provenance records absence as null, never as a guess', () => {
  const d = at({ mutating: false });
  const p = provenanceOf(d, 'inv-1');
  assert.equal(p.approvalId, null);
  assert.equal(p.inputHash, null);
});

test('🚨 preflight that never ran blocks, and is reported as a fault', () => {
  // A gate added later must not be skippable by callers that predate it.
  const d = decideToolInvocation({ ...base, preflight: undefined, mutating: true, inputHash: 'h1' });
  assert.equal(d.executable, false);
  assert.equal(d.blockedAt, 'preflight:not-run');
  assert.equal(d.preflightState, 'not_run');
});

test('preflight failure blocks BEFORE consent is considered', () => {
  const d = decideToolInvocation({
    ...base,
    preflight: { state: 'failed', reason: 'That recipient does not exist.' },
    mutating: true,
    inputHash: 'h1',
  });
  assert.equal(d.blockedAt, 'preflight:failed');
  assert.equal(d.reason, 'That recipient does not exist.');
  // Consent is not even reported as required-yet-missing; it was never reached.
  assert.equal(d.consentState, 'absent');
});

test('a tool declaring no preflight must say so explicitly', () => {
  const d = decideToolInvocation({ ...base, preflight: { state: 'not_required' } });
  assert.equal(d.executable, true);
  assert.equal(d.preflightState, 'not_required');
});
