/**
 * GOVERNED SEND — the one operation that cannot be taken back.
 *
 * Every test here is a way a real message reaches a real person wrongly. The
 * two that matter most:
 *
 *   · an approval that was never bound to the message that goes out
 *   · a retry that resolves uncertainty by sending a second copy
 *
 * Both are invisible to us and permanent to the recipient.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchSend, proposeSend, refusalMessage, type SendDeps } from '../src/engine/email/sendGovernance.js';
import { bindingFor } from '../src/engine/email/sendBinding.js';
import type { IdempotencyRecord } from '../src/engine/tools/idempotency.js';
import type { EmailConnection, EmailDraft, EmailOutcome, EmailProvider } from '../src/engine/email/types.js';

const ACCOUNT = 'owner@migrateck.com';
const IDENTITY = { toolId: 'migra.email.send', actor: 'user:1', scope: 'personal:1' };

const draft = (over: Partial<EmailDraft> = {}): EmailDraft => ({
  to: [{ address: 'james@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Contract review',
  body: 'Attached is the revised contract.',
  ...over,
});

const connection = (over: Partial<EmailConnection> = {}): EmailConnection => ({
  state: 'connected',
  account: ACCOUNT,
  scopes: { read: true, draft: true, send: true },
  checkedAt: '2026-09-08T12:00:00Z',
  ...over,
});

function harness(over: {
  provider?: Partial<EmailProvider>;
  conn?: EmailConnection;
  approval?: { state: 'approved' | 'declined' | 'expired'; draft?: EmailDraft } | null;
  record?: IdempotencyRecord | null;
} = {}) {
  const sends: EmailDraft[] = [];
  const saved: IdempotencyRecord[] = [];
  let stored: IdempotencyRecord | null = over.record ?? null;

  const approvedDraft = over.approval?.draft ?? draft();
  const deps: SendDeps = {
    provider: {
      id: 'test',
      send: async (d: EmailDraft): Promise<EmailOutcome<{ providerMessageId: string }>> => {
        sends.push(d);
        return { ok: true, value: { providerMessageId: 'msg_1' }, provider: 'test', tookMs: 1 };
      },
      ...over.provider,
    } as unknown as EmailProvider,
    currentConnection: async () => over.conn ?? connection(),
    approvalFor: async (fp) => {
      if (over.approval === null || over.approval === undefined) return null;
      const expected = proposeSend(ACCOUNT, approvedDraft).fingerprint;
      if (fp !== expected) return null;
      return { state: over.approval.state, binding: bindingFor(ACCOUNT, approvedDraft) };
    },
    loadRecord: async () => stored,
    saveRecord: async (r) => {
      saved.push(r);
      stored = r;
    },
    now: () => 1_000_000,
  };
  return { deps, sends, saved };
}

/* ------------------------------------------------------------------ *
 * The happy path exists so the refusals mean something
 * ------------------------------------------------------------------ */

test('an approved send dispatches exactly once', async () => {
  const { deps, sends } = harness({ approval: { state: 'approved' } });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, true);
  assert.equal(sends.length, 1);
});

/* ------------------------------------------------------------------ *
 * 🚨 Consent
 * ------------------------------------------------------------------ */

test('🚨 no approval means NO SEND', async () => {
  const { deps, sends } = harness({ approval: null });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  assert.equal(sends.length, 0, 'a message went out without consent');
});

test('a declined approval means no send', async () => {
  const { deps, sends } = harness({ approval: { state: 'declined' } });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'approval_declined');
  assert.equal(sends.length, 0);
});

test('an expired approval is its own refusal, not a generic failure', async () => {
  const { deps, sends } = harness({ approval: { state: 'expired' } });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'approval_expired');
  assert.equal(sends.length, 0);
});

test('🚨 changing the RECIPIENT after approval refuses the send', async () => {
  /*
   * The core failure. The user approved a message to james@; the dispatch
   * carries someone else. The approval no longer matches, so nothing goes out.
   */
  const { deps, sends } = harness({ approval: { state: 'approved', draft: draft() } });
  const result = await dispatchSend(ACCOUNT, draft({ to: [{ address: 'stranger@x.com' }] }), deps, IDENTITY);
  assert.equal(result.ok, false);
  assert.equal(sends.length, 0, 'a message went to an unapproved recipient');
});

test('🚨 changing the BODY after approval refuses the send', async () => {
  const { deps, sends } = harness({ approval: { state: 'approved', draft: draft() } });
  const result = await dispatchSend(ACCOUNT, draft({ body: 'Wire the money today.' }), deps, IDENTITY);
  assert.equal(result.ok, false);
  assert.equal(sends.length, 0, 'an unapproved body was sent');
});

/* ------------------------------------------------------------------ *
 * 🚨 Authorization is RE-CHECKED, not remembered
 * ------------------------------------------------------------------ */

test('🚨 authorization revoked AFTER approval means no send', async () => {
  /*
   * The user may have disconnected the account in another tab, or the grant may
   * have expired. Approval is consent, not authorization — treating it as both
   * dispatches with a credential we were told to stop using.
   */
  const { deps, sends } = harness({
    approval: { state: 'approved' },
    conn: connection({ state: 'authorization_expired' }),
  });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'authorization_expired');
  assert.equal(sends.length, 0);
});

test('🚨 read-only scope refuses a send, and says which scope is missing', async () => {
  // A connected account with no send scope is common and reasonable. It must
  // not read as "unavailable", which sends the user to wait for nothing.
  const { deps, sends } = harness({
    approval: { state: 'approved' },
    conn: connection({ scopes: { read: true, draft: true, send: false } }),
  });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'insufficient_scope');
  assert.equal(sends.length, 0);
});

test('a disconnected account refuses before touching the provider', async () => {
  const { deps, sends } = harness({
    approval: { state: 'approved' },
    conn: connection({ state: 'not_connected' }),
  });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'not_connected');
  assert.equal(sends.length, 0);
});

/* ------------------------------------------------------------------ *
 * 🚨 Idempotency — one email, whatever happens
 * ------------------------------------------------------------------ */

test('🚨 a duplicate dispatch of a COMMITTED send does not send twice', async () => {
  const committed: IdempotencyRecord = {
    identity: {
      ...IDENTITY,
      idempotencyKey: proposeSend(ACCOUNT, draft()).idempotencyKey,
      normalizedInputHash: proposeSend(ACCOUNT, draft()).fingerprint,
    },
    state: 'committed',
    attempt: 1,
    createdAt: 1,
    updatedAt: 2,
    result: { providerMessageId: 'msg_original' },
  };
  const { deps, sends } = harness({ approval: { state: 'approved' }, record: committed });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(sends.length, 0, 'a second copy was sent');
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result && result.refusal.kind === 'already_sent') {
    assert.equal(result.refusal.providerMessageId, 'msg_original');
  } else {
    assert.fail('a committed send was not reported as already sent');
  }
});

test('🚨 an OUTCOME_UNKNOWN record is never retried', async () => {
  /*
   * The most important refusal here. A provider that timed out after accepting
   * has already sent. Retrying resolves that ambiguity by sending again.
   */
  const unknown: IdempotencyRecord = {
    identity: {
      ...IDENTITY,
      idempotencyKey: proposeSend(ACCOUNT, draft()).idempotencyKey,
      normalizedInputHash: proposeSend(ACCOUNT, draft()).fingerprint,
    },
    state: 'outcome_unknown',
    attempt: 1,
    createdAt: 1,
    updatedAt: 2,
  };
  const { deps, sends } = harness({ approval: { state: 'approved' }, record: unknown });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(sends.length, 0, 'an uncertain outcome was retried — that is how one send becomes two');
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'outcome_unknown');
});

test('🚨 a provider THROW settles as outcome_unknown, not as a failure', async () => {
  /*
   * The request may have reached the provider and been accepted before the
   * connection broke. Settling this as failed_before_dispatch would invite a
   * retry that sends a second copy to a real person.
   */
  const { deps, saved } = harness({
    approval: { state: 'approved' },
    provider: {
      send: async () => {
        throw new Error('socket hang up');
      },
    },
  });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'outcome_unknown');
  assert.equal(saved.at(-1)!.state, 'outcome_unknown');
});

test('a provider TIMEOUT also settles as outcome_unknown', async () => {
  // A timeout proves nothing about whether the message left.
  const { deps, saved } = harness({
    approval: { state: 'approved' },
    provider: {
      send: async () => ({
        ok: false,
        failure: { kind: 'provider_timeout', waitedMs: 30_000 },
        provider: 'test',
        tookMs: 30_000,
      }),
    },
  });
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, false);
  assert.equal(saved.at(-1)!.state, 'outcome_unknown');
});

test('a refusal BEFORE dispatch settles as failed_before_dispatch, which is retryable', async () => {
  /*
   * The other side of the same coin: these prove nothing left the building, so
   * a fresh attempt is safe and the primitive is told so.
   */
  const { deps, saved } = harness({
    approval: { state: 'approved' },
    provider: {
      send: async () => ({
        ok: false,
        failure: { kind: 'insufficient_scope', needed: 'send' },
        provider: 'test',
        tookMs: 1,
      }),
    },
  });
  await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(saved.at(-1)!.state, 'failed_before_dispatch');
});

/* ------------------------------------------------------------------ *
 * What the user is told
 * ------------------------------------------------------------------ */

test('🚨 the outcome_unknown message names where the truth is and offers no retry', () => {
  const message = refusalMessage({ kind: 'outcome_unknown' });
  assert.match(message, /not clear whether/i);
  assert.match(message, /Sent mail/i, 'the user is not told where to check');
  assert.ok(!/try again now|retry/i.test(message), 'a retry was offered for an uncertain send');
});

test('a stale approval says WHICH fields changed', () => {
  const message = refusalMessage({ kind: 'approval_stale', changed: ['to', 'subject'] });
  assert.match(message, /to/);
  assert.match(message, /subject/);
});

test('no refusal message leaks a provider name, id, or capability id', () => {
  const refusals = [
    { kind: 'not_connected' as const },
    { kind: 'authorization_expired' as const },
    { kind: 'insufficient_scope' as const },
    { kind: 'approval_missing' as const },
    { kind: 'approval_expired' as const },
    { kind: 'approval_declined' as const },
    { kind: 'approval_stale' as const, changed: ['to'] },
    { kind: 'already_sent' as const },
    { kind: 'outcome_unknown' as const },
  ];
  for (const refusal of refusals) {
    const message = refusalMessage(refusal);
    for (const leak of ['gmail', 'Gmail', 'oauth', 'OAuth', 'migra.email', 'scope:', 'googleapis']) {
      assert.ok(!message.includes(leak), `"${message}" leaked "${leak}"`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 THE SECOND LINE OF DEFENCE — added because a mutation escaped
 *
 * Disabling the `changedFields` check left every test green. The harness above
 * looks approvals up BY FINGERPRINT, so a changed message returns null and is
 * caught earlier — the guard was never reached.
 *
 * A real store keyed by approval id, which is how a UI would pass one back,
 * returns the stale approval instead. Then `changedFields` is the only thing
 * between a user's consent and a different message going out.
 * ------------------------------------------------------------------ */

test('🚨 a LENIENT approval lookup is still refused when the message changed', async () => {
  const approvedDraft = draft();
  const sends: EmailDraft[] = [];

  const deps: SendDeps = {
    provider: {
      id: 'test',
      send: async (d: EmailDraft) => {
        sends.push(d);
        return { ok: true, value: { providerMessageId: 'msg_1' }, provider: 'test', tookMs: 1 };
      },
    } as unknown as EmailProvider,
    currentConnection: async () => connection(),
    /*
     * Returns the approval regardless of fingerprint — modelling a store keyed
     * by approval id. This is not a contrived case: it is the shape a consent
     * token from the UI naturally produces.
     */
    approvalFor: async () => ({ state: 'approved', binding: bindingFor(ACCOUNT, approvedDraft) }),
    loadRecord: async () => null,
    saveRecord: async () => {},
    now: () => 1_000_000,
  };

  const tampered = draft({ to: [{ address: 'stranger@x.com' }], body: 'Wire the money today.' });
  const result = await dispatchSend(ACCOUNT, tampered, deps, IDENTITY);

  assert.equal(sends.length, 0, 'a message the user never approved was sent');
  assert.equal(result.ok, false);
  if (!result.ok && 'refusal' in result && result.refusal.kind === 'approval_stale') {
    assert.deepEqual(result.refusal.changed.sort(), ['body', 'to']);
  } else {
    assert.fail(`expected approval_stale, got ${JSON.stringify(result)}`);
  }
});

test('a lenient lookup with an UNCHANGED message still sends', async () => {
  // The control. Without it the test above would pass against an
  // implementation that refuses everything.
  const sends: EmailDraft[] = [];
  const deps: SendDeps = {
    provider: {
      id: 'test',
      send: async (d: EmailDraft) => {
        sends.push(d);
        return { ok: true, value: { providerMessageId: 'msg_1' }, provider: 'test', tookMs: 1 };
      },
    } as unknown as EmailProvider,
    currentConnection: async () => connection(),
    approvalFor: async () => ({ state: 'approved', binding: bindingFor(ACCOUNT, draft()) }),
    loadRecord: async () => null,
    saveRecord: async () => {},
    now: () => 1_000_000,
  };
  const result = await dispatchSend(ACCOUNT, draft(), deps, IDENTITY);
  assert.equal(result.ok, true);
  assert.equal(sends.length, 1);
});
