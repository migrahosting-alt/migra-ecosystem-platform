/**
 * WHOSE MAILBOX IS THE HUB TALKING ABOUT?
 *
 * A connected mailbox belongs to a principal. The capability registry is a
 * process-wide singleton. Those two facts do not compose, and the failure mode
 * is not cosmetic: a registry that answered "email is available" from shared
 * state would report whoever connected most recently — to everybody — and that
 * answer sits one wiring mistake away from executing against their inbox.
 *
 * So readiness is a pure function of a connection the ROUTE resolved for the
 * caller, and these tests hold that shape in place.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emailReadinessFor,
  EMAIL_NOT_CONFIGURED,
  EMAIL_NOT_CONNECTED,
  EMAIL_RECONNECT,
  EMAIL_UNAVAILABLE,
} from '../src/engine/email/emailReadiness.js';
import type { EmailConnection } from '../src/engine/email/types.js';

const connection = (over: Partial<EmailConnection> = {}): EmailConnection => ({
  state: 'connected',
  account: 'alice@example.com',
  scopes: { read: true, draft: false, send: false },
  checkedAt: '2026-09-08T12:00:00Z',
  ...over,
});

/* ------------------------------------------------------------------ *
 * The mapping
 * ------------------------------------------------------------------ */

test('a connected, read-permitted account is ready and says nothing', () => {
  assert.deepEqual(emailReadinessFor(connection()), { ready: true });
});

test('🚨 an UNRESOLVED context is not treated as available', () => {
  /*
   * `null` means the route did not resolve a connection — no email feature, or
   * a lookup that failed. A probe that needs a fact it was not given must
   * refuse rather than assume, or a deployment with no mail at all would offer
   * a working Email row.
   */
  const readiness = emailReadinessFor(null);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, EMAIL_NOT_CONFIGURED);
  assert.equal(readiness.remedy, undefined, 'an unresolved context offered the user a button');
});

test('not connected is the user’s to fix', () => {
  assert.deepEqual(emailReadinessFor(connection({ state: 'not_connected' })), {
    ready: false,
    reason: EMAIL_NOT_CONNECTED,
    remedy: 'connect-account',
  });
});

test('an expired grant asks to RECONNECT', () => {
  assert.deepEqual(emailReadinessFor(connection({ state: 'authorization_expired' })), {
    ready: false,
    reason: EMAIL_RECONNECT,
    remedy: 'reconnect-account',
  });
});

test('🚨 an outage carries a reason and NO remedy', () => {
  // Offering a button here has people re-authorising a working account during
  // an outage, which cannot succeed while the provider is down.
  const readiness = emailReadinessFor(connection({ state: 'provider_unavailable' }));
  assert.equal(readiness.reason, EMAIL_UNAVAILABLE);
  assert.equal(readiness.remedy, undefined);
});

test('🚨 CONNECTED is not the same as PERMITTED', () => {
  /*
   * A grant that came back without read scope would otherwise render as fully
   * available and then refuse every question. Reconnecting is the remedy,
   * because a wider consent is what fixes it.
   */
  const readiness = emailReadinessFor(connection({ scopes: { read: false, draft: false, send: false } }));
  assert.equal(readiness.ready, false, 'a connection with no read permission reported as ready');
  assert.equal(readiness.remedy, 'reconnect-account');
});

test('🚨 every unavailable state carries a reason a person could read', () => {
  const states: EmailConnection['state'][] = [
    'not_configured', 'not_connected', 'authorization_expired', 'provider_unavailable',
  ];
  for (const state of states) {
    const readiness = emailReadinessFor(connection({ state }));
    assert.equal(readiness.ready, false, `${state} reported ready`);
    assert.ok(readiness.reason, `${state} was unavailable with no explanation`);
    assert.ok(!/google|gmail|oauth|token|scope|invalid_grant/i.test(readiness.reason!),
      `machinery leaked into a user-facing reason: ${readiness.reason}`);
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 The registry answers PER CALLER
 * ------------------------------------------------------------------ */

test('🚨 two principals get different answers from the same registry', async () => {
  /*
   * The property the whole design exists for. One registry instance, two
   * callers, two connection states — and the answers must not bleed.
   */
  const { CapabilityRegistry } = await import('../src/engine/models/capabilityRegistry.js');
  const registry = new CapabilityRegistry();

  const forAlice = registry.list({ includeUnavailable: true }, { mail: connection() })
    .find((c) => c.id === 'migra.email');
  const forBob = registry.list({ includeUnavailable: true }, { mail: connection({ state: 'not_connected' }) })
    .find((c) => c.id === 'migra.email');

  assert.ok(forAlice, 'migra.email is not registered');
  assert.ok(forBob);
  assert.equal(forAlice!.available, true, "a connected caller's email was reported unavailable");
  assert.equal(forBob!.available, false, "an unconnected caller saw someone else's connection");
  assert.equal(forBob!.remedy, 'connect-account');
  assert.equal(forAlice!.remedy, undefined);
});

test('🚨 a list with NO context reports email unavailable, never available', async () => {
  /*
   * A caller that forgot to resolve the context must not be handed a working
   * capability. Failing toward "unavailable" makes the omission visible as a
   * missing row rather than as access to a mailbox nobody checked.
   */
  const { CapabilityRegistry } = await import('../src/engine/models/capabilityRegistry.js');
  const registry = new CapabilityRegistry();
  const email = registry.list({ includeUnavailable: true }).find((c) => c.id === 'migra.email');
  assert.ok(email);
  assert.equal(email!.available, false, 'email was available with no connection resolved at all');
});
