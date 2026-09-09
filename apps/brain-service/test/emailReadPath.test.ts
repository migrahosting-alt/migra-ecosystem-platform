/**
 * THE READ PATH — and the rule that only a real answer may become "nothing found".
 *
 * `no_results` is a claim about the USER'S MAILBOX. Every other failure is a
 * claim about us: our configuration, our authorization, our reachability.
 * Reporting one as the other tells someone their inbox is empty when nobody
 * looked, and they have no way to tell the difference.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMAIL_NOT_CONFIGURED,
  EMAIL_NOT_CONNECTED,
  EMAIL_RECONNECT,
  MigraEmail,
} from '../src/engine/email/migraEmail.js';
import type {
  EmailConnection,
  EmailMessage,
  EmailProvider,
  EmailQuery,
  EmailThread,
} from '../src/engine/email/types.js';

const QUERY: EmailQuery = { limit: 10 };

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  providerMessageId: 'm1',
  providerThreadId: 't1',
  from: { address: 'hetzner@hetzner.com', name: 'Hetzner' },
  to: [{ address: 'owner@migrateck.com' }],
  cc: [],
  subject: 'Invoice 2026-09',
  sentAt: '2026-09-05T10:00:00.000Z',
  snippet: 'Your invoice is attached.',
  bodyComplete: false,
  // Snippet-shaped fixture: presence was never determined.
  attachmentsKnown: false,
  attachments: [],
  labels: ['INBOX'],
  unread: true,
  retrievedAt: '2026-09-08T12:00:00.000Z',
  ...over,
});

const connection = (over: Partial<EmailConnection> = {}): EmailConnection => ({
  state: 'connected',
  account: 'owner@migrateck.com',
  scopes: { read: true, draft: true, send: true },
  checkedAt: '2026-09-08T12:00:00Z',
  ...over,
});

function provider(over: Partial<EmailProvider> = {}, conn = connection()): EmailProvider {
  return {
    id: 'test',
    health: async () => conn,
    search: async () => ({ ok: true, value: [message()], provider: 'test', tookMs: 1 }),
    readMessage: async () => ({ ok: true, value: message(), provider: 'test', tookMs: 1 }),
    readThread: async () => ({
      ok: true,
      value: { providerThreadId: 't1', subject: 'Invoice', messages: [message()] },
      provider: 'test',
      tookMs: 1,
    }),
    listAttachments: async () => ({ ok: true, value: [], provider: 'test', tookMs: 1 }),
    readAttachment: async () => ({ ok: false, failure: { kind: 'not_found' }, provider: 'test', tookMs: 1 }),
    createDraft: async () => ({ ok: true, value: { providerDraftId: 'd1' }, provider: 'test', tookMs: 1 }),
    send: async () => ({ ok: true, value: { providerMessageId: 'sent1' }, provider: 'test', tookMs: 1 }),
    ...over,
  } as EmailProvider;
}

/* ------------------------------------------------------------------ *
 * 🚨 The states that must never collapse
 * ------------------------------------------------------------------ */

test('🚨 NOT CONFIGURED is not "no results"', async () => {
  const email = new MigraEmail();
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'not_configured');
});

test('🚨 NOT CONNECTED is not "no results", and not "unavailable"', async () => {
  /*
   * A user who never linked an account is not having an outage. Telling them
   * "no messages found" asserts something about a mailbox nobody opened;
   * telling them "unavailable" sends them to wait for a working service.
   */
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'not_connected' })) });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'not_connected');
});

test('🚨 REVOKED authorization is distinct from never connected', async () => {
  // They did connect. The remedy is reconnecting, not starting from nothing.
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'authorization_expired' })) });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'authorization_expired');
});

test('🚨 a provider that THROWS is unavailable, not empty', async () => {
  const email = new MigraEmail({
    provider: provider({
      search: async () => {
        throw new Error('ECONNRESET');
      },
    }),
  });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_unavailable');
});

test('a provider timeout stays a timeout', async () => {
  const email = new MigraEmail({
    provider: provider({
      search: async () => ({
        ok: false,
        failure: { kind: 'provider_timeout', waitedMs: 30_000 },
        provider: 'test',
        tookMs: 30_000,
      }),
    }),
  });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'provider_timeout');
});

test('🚨 an EMPTY list from a working provider is the only "nothing found"', async () => {
  /*
   * And it stays an `ok` outcome carrying an empty array, so the caller can
   * say "I looked and there was nothing" distinctly from "I could not look".
   */
  const email = new MigraEmail({
    provider: provider({ search: async () => ({ ok: true, value: [], provider: 'test', tookMs: 1 }) }),
  });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, true, 'an empty mailbox was reported as a failure');
  if (outcome.ok) assert.deepEqual(outcome.value, []);
});

test('read-only scope blocks a send gate but not a read', async () => {
  const email = new MigraEmail({
    provider: provider({}, connection({ scopes: { read: true, draft: false, send: false } })),
  });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, true, 'read was blocked by a missing SEND scope');
});

test('missing READ scope blocks search with the scope named', async () => {
  const email = new MigraEmail({
    provider: provider({}, connection({ scopes: { read: false, draft: false, send: false } })),
  });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, false);
  if (!outcome.ok && outcome.failure.kind === 'insufficient_scope') {
    assert.equal(outcome.failure.needed, 'read');
  } else {
    assert.fail('a missing read scope was not reported as such');
  }
});

/* ------------------------------------------------------------------ *
 * Threads
 * ------------------------------------------------------------------ */

test('🚨 a thread is ordered chronologically, whatever order the provider gives', async () => {
  /*
   * A provider returning newest-first would make a summary describe the
   * conversation backwards — and "the latest message says X" would name the
   * oldest one.
   */
  const out: EmailThread = {
    providerThreadId: 't1',
    subject: 'Invoice',
    messages: [
      message({ providerMessageId: 'c', sentAt: '2026-09-07T00:00:00.000Z' }),
      message({ providerMessageId: 'a', sentAt: '2026-09-01T00:00:00.000Z' }),
      message({ providerMessageId: 'b', sentAt: '2026-09-03T00:00:00.000Z' }),
    ],
  };
  const email = new MigraEmail({
    provider: provider({ readThread: async () => ({ ok: true, value: out, provider: 'test', tookMs: 1 }) }),
  });
  const result = await email.readThread('t1');
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.messages.map((m) => m.providerMessageId), ['a', 'b', 'c']);
  }
});

test('🚨 thread membership is NOT inferred from subject', async () => {
  /*
   * "Re: invoice" appears on unrelated conversations. Grouping by it would show
   * a user messages from a thread they were not reading — and could let a reply
   * reach that thread's participants.
   *
   * Asserted structurally: the authority passes a THREAD ID to the provider and
   * has no code path that groups by subject.
   */
  let askedWith: string | null = null;
  const email = new MigraEmail({
    provider: provider({
      readThread: async (id: string) => {
        askedWith = id;
        return {
          ok: true,
          value: { providerThreadId: id, subject: 'Re: invoice', messages: [message()] },
          provider: 'test',
          tookMs: 1,
        };
      },
    }),
  });
  await email.readThread('thread_abc');
  assert.equal(askedWith, 'thread_abc', 'the thread was not requested by its provider id');
});

/* ------------------------------------------------------------------ *
 * 🚨 Body completeness
 * ------------------------------------------------------------------ */

test('🚨 search results carry bodyComplete=false — they are snippets', async () => {
  /*
   * A list call returns previews. Losing this flag makes it impossible for a
   * summary to disclose that it is working from three lines of a long thread.
   */
  const email = new MigraEmail({ provider: provider() });
  const outcome = await email.search(QUERY);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value[0]!.bodyComplete, false);
    assert.equal(outcome.value[0]!.textBody, undefined, 'a snippet was presented as a body');
  }
});

test('a full read may carry bodyComplete=true with a real body', async () => {
  const email = new MigraEmail({
    provider: provider({
      readMessage: async () => ({
        ok: true,
        value: message({ bodyComplete: true, textBody: 'The whole message, all of it.' }),
        provider: 'test',
        tookMs: 1,
      }),
    }),
  });
  const outcome = await email.readMessage('m1');
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value.bodyComplete, true);
    assert.equal(outcome.value.textBody, 'The whole message, all of it.');
  }
});

/* ------------------------------------------------------------------ *
 * Readiness — per operation, never one boolean
 * ------------------------------------------------------------------ */

test('🚨 with no provider: registered, unavailable, and honest about why', async () => {
  const email = new MigraEmail();
  const readiness = email.readiness();
  assert.equal(readiness.registered, true);
  assert.equal(readiness.providerConfigured, false);
  assert.equal(readiness.readAvailable, false);
  assert.equal(readiness.sendAvailable, false);
  assert.equal(readiness.reason, EMAIL_NOT_CONFIGURED);
});

test('a configured provider with no connected account says NOT CONNECTED', async () => {
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'not_connected' })) });
  await email.refreshConnection();
  const readiness = email.readiness();
  assert.equal(readiness.providerConfigured, true);
  assert.equal(readiness.accountConnected, false);
  assert.equal(readiness.reason, EMAIL_NOT_CONNECTED);
});

test('🚨 read available and send UNavailable is representable', async () => {
  /*
   * The state a single boolean cannot express, and a common one for a real
   * Google account. A global flag would hide working search, or promise a send
   * that fails at dispatch.
   */
  const email = new MigraEmail({
    provider: provider({}, connection({ scopes: { read: true, draft: false, send: false } })),
  });
  await email.refreshConnection();
  const readiness = email.readiness();
  assert.equal(readiness.readAvailable, true);
  assert.equal(readiness.sendAvailable, false);
});

test('revoked authorization keeps accountConnected TRUE — the remedy differs', async () => {
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'authorization_expired' })) });
  await email.refreshConnection();
  const readiness = email.readiness();
  assert.equal(readiness.accountConnected, true, 'a revoked account read as never connected');
  assert.equal(readiness.reason, EMAIL_RECONNECT);
});

test('🚨 no reason ever names a provider, host, or OAuth concept', async () => {
  const states: EmailConnection['state'][] = [
    'not_configured',
    'not_connected',
    'authorization_expired',
    'provider_unavailable',
  ];
  for (const state of states) {
    const email = new MigraEmail({ provider: provider({}, connection({ state })) });
    await email.refreshConnection();
    const reason = email.readiness().reason ?? '';
    for (const leak of ['gmail', 'Gmail', 'oauth', 'OAuth', 'googleapis', 'token', 'scope=', 'refresh']) {
      assert.ok(!reason.includes(leak), `readiness reason leaked "${leak}": ${reason}`);
    }
  }
});

test('a health probe that throws reports unavailable, not the exception', async () => {
  const email = new MigraEmail({
    provider: provider({
      health: async () => {
        throw new Error('invalid_grant: token has been expired or revoked');
      },
    }),
  });
  const connectionState = await email.refreshConnection();
  assert.equal(connectionState.state, 'provider_unavailable');
  assert.ok(!connectionState.reason!.includes('invalid_grant'), 'a provider error string reached the reason');
});

/* ------------------------------------------------------------------ *
 * 🚨 A remedy is a TOKEN, never prose to be parsed
 * ------------------------------------------------------------------ */

test('🚨 not-connected offers a remedy the USER can act on', async () => {
  /*
   * The consumer must never read `reason` to decide whether to draw a Connect
   * button. Parsing prose to infer a state is a keyword proxy: it breaks
   * silently the first time someone improves a sentence, and the control
   * disappears with no test failing.
   */
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'not_connected' })) });
  // readiness() reads a CACHED connection; without this the snapshot is null
  // and every state collapses to "not connected", which would make the next
  // three assertions pass for the wrong reason.
  await email.refreshConnection();
  const readiness = email.readiness();
  assert.equal(readiness.readAvailable, false);
  assert.equal(readiness.remedy, 'connect-account');
});

test('🚨 an expired grant asks to RECONNECT, a different remedy from connecting', async () => {
  // They did connect. Offering "Connect" would describe a first-time action to
  // someone whose account is already linked.
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'authorization_expired' })) });
  await email.refreshConnection();
  assert.equal(email.readiness().remedy, 'reconnect-account');
});

test('🚨 an UNCONFIGURED deployment offers NO remedy', () => {
  /*
   * Nothing the user does can fix a missing OAuth client. A Connect button here
   * sends someone to press a control that cannot help — and then to press it
   * again, because nothing changed.
   */
  const email = new MigraEmail({});
  const readiness = email.readiness();
  assert.equal(readiness.providerConfigured, false);
  assert.ok(readiness.reason, 'an unconfigured deployment said nothing at all');
  assert.equal(readiness.remedy, undefined, 'a deployment fault offered the user a button');
});

test('🚨 an UNREACHABLE provider offers no remedy either — the remedy is time', async () => {
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'provider_unavailable' })) });
  await email.refreshConnection();
  assert.equal(email.readiness().remedy, undefined, 'an outage offered the user a button');
});

test('a working connection has no remedy, because nothing is wrong', async () => {
  const email = new MigraEmail({ provider: provider({}, connection({ state: 'connected' })) });
  await email.refreshConnection();
  const readiness = email.readiness();
  assert.equal(readiness.readAvailable, true);
  assert.equal(readiness.remedy, undefined);
});
