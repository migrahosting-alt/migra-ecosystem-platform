/**
 * THE GMAIL TRANSPORT — what a status code MEANS for a mailbox.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS FILE EXISTS
 *
 * Every read above this adapter was tested against a fake provider, and the
 * adapter itself refused every operation. The whole read path passed while
 * nothing could reach Gmail — a real connection, a real token, and
 * `not_configured` on every search. Fakes prove the shape of a contract; they
 * cannot prove anyone implemented it.
 *
 * So these tests drive the REAL adapter through an injected transport. The
 * branches that matter most are the ones a live mailbox cannot show you on
 * demand: a 403 during a rate limit, a 500 in the middle of a search, a body
 * that will not parse.
 *
 * ---------------------------------------------------------------------------
 * THE MAPPING IS THE PRODUCT
 *
 * `authorization_expired` sends a user to reconnect. `provider_unavailable`
 * tells them to wait. Confusing the two during a Google incident tells every
 * user to re-grant access — which cannot work, and overwrites a stored grant
 * that was never broken. Each assertion below is that distinction.
 *
 * NO PERSONAL MAILBOX DATA. Every payload here is synthetic.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { GmailProvider } from '../src/engine/email/gmailProvider.js';
import type { EmailFailure } from '../src/engine/email/types.js';

/* ------------------------------------------------------------------ *
 * The injected transport
 * ------------------------------------------------------------------ */

type Reply =
  | { status: number; body: unknown }
  /** A 200 whose body will not parse. */
  | { status: 200; unparseable: true }
  /** The network itself refused. */
  | { throws: true }
  /** Accepts the connection and never answers. */
  | { hangs: true };

interface Recorded {
  url: string;
  authorization: string | undefined;
}

function transport(replies: Reply[] | ((url: string) => Reply)): {
  fetch: typeof globalThis.fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  let index = 0;

  const fake = async (input: unknown, init: unknown): Promise<unknown> => {
    const url = String(input);
    const options = (init ?? {}) as { headers?: Record<string, string>; signal?: AbortSignal };
    calls.push({ url, authorization: options.headers?.authorization });

    const reply = typeof replies === 'function' ? replies(url) : replies[Math.min(index++, replies.length - 1)]!;

    if ('throws' in reply) throw new TypeError('fetch failed');
    if ('hangs' in reply) {
      // Answers only when OUR ceiling aborts it. Without a timeout of our own
      // this promise never settles, which is the hang being tested for.
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    if ('unparseable' in reply) {
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } };
    }
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    };
  };

  return { fetch: fake as unknown as typeof globalThis.fetch, calls };
}

const TOKEN = 'ya29.SECRET-TOKEN-VALUE';

function gmail(replies: Reply[] | ((url: string) => Reply), over: Record<string, unknown> = {}) {
  const wired = transport(replies);
  const provider = new GmailProvider({
    accessToken: TOKEN,
    accountAddress: 'qa@example.com',
    scopes: { read: true, draft: false, send: false },
    fetch: wired.fetch,
    baseUrl: 'https://gmail.test/v1/users/me',
    ...over,
  });
  return { provider, calls: wired.calls };
}

/** A synthetic Gmail message, in the shape its API returns. */
function raw(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX'],
    snippet: 'A preview of the message.',
    internalDate: '1757404800000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Billing <billing@example.com>' },
        { name: 'To', value: 'qa@example.com' },
        { name: 'Subject', value: 'Invoice 2026-09' },
      ],
      body: { data: Buffer.from('The full body of the message.').toString('base64url') },
    },
    ...over,
  };
}

/** The error envelope Gmail returns, reduced to the one field we read. */
const envelope = (reason: string) => ({ error: { errors: [{ reason }] } });

const kindOf = (failure: EmailFailure): string => failure.kind;

/* ------------------------------------------------------------------ *
 * 🚨 A status code is not a failure kind
 * ------------------------------------------------------------------ */

test('🚨 401 is the GRANT failing — the token was minted moments before this call', async () => {
  const { provider } = gmail([{ status: 401, body: envelope('authError') }]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'authorization_expired');
});

test('🚨 403 for MISSING SCOPE is insufficient_scope, not an outage', async () => {
  const { provider } = gmail([{ status: 403, body: envelope('insufficientPermissions') }]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(kindOf(outcome.failure), 'insufficient_scope');
    if (outcome.failure.kind === 'insufficient_scope') assert.equal(outcome.failure.needed, 'read');
  }
});

test('🚨 403 for a RATE LIMIT never tells the user to reconnect', async () => {
  /*
   * Gmail overloads 403. Answering a rate limit with "reconnect your account"
   * sends someone to grant WIDER access to fix a problem that was never about
   * permission — and each attempt overwrites a working stored grant.
   */
  for (const reason of ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded']) {
    const { provider } = gmail([{ status: 403, body: envelope(reason) }]);
    const outcome = await provider.search({ limit: 5 });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(kindOf(outcome.failure), 'provider_unavailable', `${reason} was misread`);
      assert.notEqual(kindOf(outcome.failure), 'authorization_expired');
    }
  }
});

test('404 is not_found', async () => {
  const { provider } = gmail([{ status: 404, body: envelope('notFound') }]);
  const outcome = await provider.readMessage('missing');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'not_found');
});

test('🚨 429 and every 5xx are unavailability, NEVER a revoked grant', async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const { provider } = gmail([{ status, body: {} }]);
    const outcome = await provider.search({ limit: 5 });
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_unavailable', `HTTP ${status} was misread`);
  }
});

test('🚨 an UNRECOGNISED 400 is unavailability, not an inferred expiry', async () => {
  // Guessing "expired" from an unfamiliar status is how a working connection
  // gets thrown away during an outage that had nothing to do with it.
  const { provider } = gmail([{ status: 400, body: { error: { message: 'something new' } } }]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_unavailable');
});

test('an error body that is absent or not JSON still maps by status', async () => {
  // An error body is a courtesy, not a guarantee. Its absence must not turn a
  // mapped failure into a thrown one.
  const { provider } = gmail([{ status: 401, unparseable: true } as unknown as Reply]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
});

/* ------------------------------------------------------------------ *
 * 🚨 The ceiling is ours
 * ------------------------------------------------------------------ */

test('🚨 a provider that never answers becomes a TIMEOUT, not a hang', async () => {
  const { provider } = gmail([{ hangs: true }], { timeoutMs: 20 });
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_timeout');
});

test('a refused connection is unavailability', async () => {
  const { provider } = gmail([{ throws: true }]);
  const outcome = await provider.readMessage('m1');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_unavailable');
});

/* ------------------------------------------------------------------ *
 * 🚨 Only a real answer may become "nothing found"
 * ------------------------------------------------------------------ */

test('🚨 an empty mailbox returns an EMPTY LIST, never a failure', async () => {
  /*
   * `no_results` is a claim about the user's mailbox and only the authority
   * above may make it, from a real answer. An adapter that manufactured it
   * would make "nobody looked" indistinguishable from "nothing matched".
   */
  const { provider } = gmail([{ status: 200, body: {} }]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.deepEqual(outcome.value, []);
});

test('🚨 a 200 we cannot parse is NOT an empty mailbox', async () => {
  // The single rule this subsystem exists to protect: our failure must never
  // be reported as a fact about their inbox.
  const { provider } = gmail([{ status: 200, unparseable: true }]);
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_unavailable');
});

/* ------------------------------------------------------------------ *
 * 🚨 Search returns previews; only a read earns "complete"
 * ------------------------------------------------------------------ */

test('🚨 search asks for METADATA, so no result can claim a complete body', async () => {
  const { provider, calls } = gmail((url) =>
    url.includes('/messages/')
      ? { status: 200, body: raw({ payload: { headers: [{ name: 'Subject', value: 'Invoice' }] } }) }
      : { status: 200, body: { messages: [{ id: 'm1' }] } });

  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const get = calls.find((call) => call.url.includes('/messages/'))!;
  assert.match(get.url, /format=metadata/, 'search asked for full bodies');
  assert.equal(outcome.value[0]!.bodyComplete, false, 'a search result claimed a complete body');
});

test('readMessage asks for the FULL message, and that is what earns bodyComplete', async () => {
  const { provider, calls } = gmail([{ status: 200, body: raw() }]);
  const outcome = await provider.readMessage('m1');
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.match(calls[0]!.url, /format=full/);
    assert.equal(outcome.value.bodyComplete, true);
    assert.equal(outcome.value.textBody, 'The full body of the message.');
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 Partial results
 * ------------------------------------------------------------------ */

test('🚨 a message that vanished between the list and the get is SKIPPED', async () => {
  // Deleted mid-search genuinely is not in the mailbox any more.
  const { provider } = gmail((url) => {
    if (url.includes('/messages/gone')) return { status: 404, body: {} };
    if (url.includes('/messages/')) return { status: 200, body: raw() };
    return { status: 200, body: { messages: [{ id: 'm1' }, { id: 'gone' }] } };
  });
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, true);
  if (outcome.ok) assert.equal(outcome.value.length, 1);
});

test('🚨 a message we FAILED TO READ fails the whole search rather than being dropped', async () => {
  /*
   * Dropping it would under-report someone's inbox with nothing saying so —
   * the same class of lie as reporting an outage as an empty mailbox.
   */
  const { provider } = gmail((url) => {
    if (url.includes('/messages/boom')) return { status: 500, body: {} };
    if (url.includes('/messages/')) return { status: 200, body: raw() };
    return { status: 200, body: { messages: [{ id: 'm1' }, { id: 'boom' }] } };
  });
  const outcome = await provider.search({ limit: 5 });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'provider_unavailable');
});

/* ------------------------------------------------------------------ *
 * 🚨 A thread id is not expressible in Gmail's query grammar
 * ------------------------------------------------------------------ */

test('🚨 searching WITHIN a thread does not search the whole mailbox', async () => {
  /*
   * `q` has no thread operator. Passing the rest of the query and dropping the
   * thread id would silently search everything and present the result as that
   * conversation.
   */
  const { provider, calls } = gmail((url) =>
    url.includes('/threads/')
      ? { status: 200, body: { id: 't1', messages: [raw(), raw({ id: 'm2', internalDate: '1757491200000' })] } }
      : { status: 200, body: { messages: [{ id: 'other' }] } });

  const outcome = await provider.search({ limit: 5, threadId: 't1' });
  assert.equal(outcome.ok, true);
  assert.ok(calls.every((call) => !call.url.includes('/messages?')), 'a thread search hit the whole mailbox');
  if (outcome.ok) assert.equal(outcome.value.length, 2);
});

test('a thread is returned OLDEST FIRST whatever order the provider sent', async () => {
  // Everything downstream reads "the last message" as the latest one; a summary
  // answering from the wrong end of a thread reads as confidently wrong.
  const { provider } = gmail([{
    status: 200,
    body: {
      id: 't1',
      messages: [
        raw({ id: 'later', internalDate: '1757491200000' }),
        raw({ id: 'earlier', internalDate: '1757404800000' }),
      ],
    },
  }]);
  const outcome = await provider.readThread('t1');
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.deepEqual(outcome.value.messages.map((m) => m.providerMessageId), ['earlier', 'later']);
  }
});

test('an empty thread is not_found rather than an empty conversation', async () => {
  const { provider } = gmail([{ status: 200, body: { id: 't1', messages: [] } }]);
  const outcome = await provider.readThread('t1');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'not_found');
});

/* ------------------------------------------------------------------ *
 * 🚨 Attachments
 * ------------------------------------------------------------------ */

const WITH_ATTACHMENT = raw({
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'Invoice' }],
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64url') } },
      {
        mimeType: 'application/pdf',
        filename: 'invoice.pdf',
        body: { attachmentId: 'att1', size: 1024 },
      },
    ],
  },
});

test('listAttachments reads the FULL message, because ids live in the MIME tree', async () => {
  const { provider, calls } = gmail([{ status: 200, body: WITH_ATTACHMENT }]);
  const outcome = await provider.listAttachments('m1');
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.match(calls[0]!.url, /format=full/, 'a metadata read would report no attachments at all');
    assert.deepEqual(outcome.value.map((a) => a.filename), ['invoice.pdf']);
  }
});

test('🚨 the filename and type come from the MESSAGE, never from the caller', async () => {
  /*
   * Gmail's attachment endpoint returns bytes and a size and nothing else. A
   * caller-supplied name would let a prompt decide what a downloaded file
   * claims to be.
   */
  const { provider } = gmail((url) =>
    url.includes('/attachments/')
      ? { status: 200, body: { data: Buffer.from('%PDF-1.4 real bytes').toString('base64url') } }
      : { status: 200, body: WITH_ATTACHMENT });

  /*
   * Resolved by OUR ref, obtained from a listing — the provider's own id is
   * regenerated per read and cannot be held onto.
   */
  const listed = await provider.listAttachments('m1');
  assert.equal(listed.ok, true);
  if (!listed.ok) return;

  const outcome = await provider.readAttachment('m1', listed.value[0]!.ref);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value.filename, 'invoice.pdf');
    assert.equal(outcome.value.mimeType, 'application/pdf');
    assert.equal(Buffer.from(outcome.value.bytes).toString('utf8'), '%PDF-1.4 real bytes');
  }
});

test('🚨 an attachment id that is not on this message is REFUSED, not fetched', async () => {
  // An attachment id is only meaningful against the message that carries it.
  const { provider, calls } = gmail([{ status: 200, body: WITH_ATTACHMENT }]);
  const outcome = await provider.readAttachment('m1', 'someone-elses-attachment');
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'not_found');
  assert.ok(calls.every((call) => !call.url.includes('/attachments/')), 'bytes were fetched anyway');
});

/* ------------------------------------------------------------------ *
 * 🚨 The credential
 * ------------------------------------------------------------------ */

test('🚨 the token is sent as a bearer and appears NOWHERE else', async () => {
  const { provider, calls } = gmail([{ status: 401, body: envelope('authError') }]);
  const outcome = await provider.search({ limit: 5 });

  assert.equal(calls[0]!.authorization, `Bearer ${TOKEN}`);
  // Not in the URL, and not in anything we hand back.
  assert.ok(!calls[0]!.url.includes(TOKEN), 'the token was placed in a URL, where it gets logged');
  assert.ok(!JSON.stringify(outcome).includes('SECRET-TOKEN-VALUE'), 'a failure carried the token');
});

test('🚨 with no credentials every read still refuses, and nothing is dispatched', async () => {
  // The unconfigured state has to survive the transport existing.
  const wired = transport([{ status: 200, body: raw() }]);
  const provider = new GmailProvider({ fetch: wired.fetch, baseUrl: 'https://gmail.test/v1/users/me' });

  for (const outcome of [
    await provider.search({ limit: 5 }),
    await provider.readMessage('m1'),
    await provider.readThread('t1'),
    await provider.listAttachments('m1'),
    await provider.readAttachment('m1', 'att1'),
  ]) {
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(kindOf(outcome.failure), 'not_configured');
  }
  assert.equal(wired.calls.length, 0, 'an unconfigured adapter reached the network');
});

/* ------------------------------------------------------------------ *
 * 🚨 Read-only, structurally
 * ------------------------------------------------------------------ */

test('🚨 the adapter CANNOT send, even holding a token and a send scope', async () => {
  /*
   * The refusal is the absence of an implementation, not a flag somebody can
   * flip. Governance above refuses first; this is the floor beneath it.
   */
  const wired = transport([{ status: 200, body: { id: 'sent' } }]);
  const provider = new GmailProvider({
    accessToken: TOKEN,
    scopes: { read: true, draft: true, send: true },
    fetch: wired.fetch,
    baseUrl: 'https://gmail.test/v1/users/me',
  });

  const draft = { to: [], cc: [], bcc: [], subject: 's', body: 'b' };
  assert.equal((await provider.createDraft(draft)).ok, false);
  assert.equal((await provider.send(draft, 'key')).ok, false);
  assert.equal(wired.calls.length, 0, 'a write reached the network');
});

test('🚨 no mutating HTTP verb appears in the adapter at all', async () => {
  /*
   * Asserted against the SOURCE because the guarantee is the absence of a
   * capability, and absence has no runtime behaviour to observe.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/email/gmailProvider.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const verb of ["'POST'", "'PUT'", "'PATCH'", "'DELETE'", '/send', '/drafts', '/trash', '/modify']) {
    assert.ok(!code.includes(verb), `the read-only adapter can mutate a mailbox: ${verb}`);
  }
});
