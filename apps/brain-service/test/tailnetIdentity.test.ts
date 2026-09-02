// The tailnet identity gate: who may reach the Brain through tailscale serve.
//
// These pin behaviour that was MEASURED against the live endpoint, so a future
// refactor cannot quietly reintroduce the hole:
//   user node via Serve   -> identity present, x-forwarded-for set
//   tagged server         -> no identity,      x-forwarded-for set
//   on-host loopback      -> no identity,      NO x-forwarded-for

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readTailnetIdentity,
  decideTailnetAccess,
  IDENTITY_EXEMPT_PATHS,
} from '../src/engine/tailnetIdentity.js';

const USER = {
  'tailscale-user-login': 'migrahosting@gmail.com',
  'tailscale-user-name': 'Migra Hosting',
  'tailscale-user-profile-pic': 'https://example.invalid/p.png',
  'x-forwarded-for': '100.86.143.93',
};
const TAGGED_NODE = { 'x-forwarded-for': '100.114.228.57' };
const ON_HOST = { host: '127.0.0.1:3988' };
const ENFORCE = { enforce: true };

test('a user-owned node through Serve is identified', () => {
  const id = readTailnetIdentity(USER);
  assert.equal(id.present, true);
  assert.equal(id.login, 'migrahosting@gmail.com');
  assert.deepEqual(id.headersSeen.length, 3);
});

test('a tagged server through Serve carries no identity', () => {
  assert.equal(readTailnetIdentity(TAGGED_NODE).present, false);
});

test('a tailnet user is allowed', () => {
  const d = decideTailnetAccess(USER, ENFORCE);
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'tailnet_user');
});

test('a tagged node through Serve is REFUSED — this is the whole point', () => {
  const d = decideTailnetAccess(TAGGED_NODE, ENFORCE);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'tagged_node_without_user');
});

test('an on-host loopback caller is allowed — monitoring must not break', () => {
  const d = decideTailnetAccess(ON_HOST, ENFORCE);
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'on_host');
});

test('a tagged node cannot fake being on-host, because Serve always sets x-forwarded-for', () => {
  // Even with every identity header it can invent, the proxy marker gives it away.
  const forging = { ...TAGGED_NODE, 'tailscale-user-login': 'migrahosting@gmail.com' };
  // Serve overrides client-supplied identity, so the Brain never sees that header
  // from a tagged node; this asserts the rule we apply to what DOES arrive.
  assert.equal(decideTailnetAccess({ 'x-forwarded-for': '100.1.1.1' }, ENFORCE).allow, false);
  // And when identity IS present (i.e. Serve put it there), access is granted.
  assert.equal(decideTailnetAccess(forging, ENFORCE).allow, true);
});

test('an allowlist restricts to named users, case-insensitively', () => {
  const opts = { enforce: true, allowedLogins: ['MigraHosting@Gmail.com'] };
  assert.equal(decideTailnetAccess(USER, opts).allow, true);
  const other = { ...USER, 'tailscale-user-login': 'someone@else.example' };
  const d = decideTailnetAccess(other, opts);
  assert.equal(d.allow, false);
  assert.equal(d.reason, 'user_not_allowed');
});

test('an empty allowlist means any tailnet user — not "nobody"', () => {
  assert.equal(decideTailnetAccess(USER, { enforce: true, allowedLogins: [] }).allow, true);
});

test('enforcement can be switched off without becoming silent', () => {
  const d = decideTailnetAccess(TAGGED_NODE, { enforce: false });
  assert.equal(d.allow, true);
  assert.equal(d.reason, 'enforcement_disabled', 'the reason must still say why it passed');
});

test('health and whoami stay reachable, so monitoring and diagnosis survive', () => {
  assert.ok(IDENTITY_EXEMPT_PATHS.includes('/health'));
  assert.ok(IDENTITY_EXEMPT_PATHS.includes('/api/identity/whoami'));
});
