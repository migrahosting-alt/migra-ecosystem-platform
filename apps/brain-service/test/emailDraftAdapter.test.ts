/**
 * COMPOSITION AND THE GMAIL ADAPTER.
 *
 * Two rules carry most of the weight here:
 *
 *   · a "draft" that appears in the user's Drafts folder is a MUTATION of
 *     their mailbox, not a free preview
 *   · threading comes from ids; a reply threaded by subject can land in a
 *     stranger's conversation and reach its participants
 *
 * Every Gmail fixture below is synthetic. A recorded payload from a real inbox
 * would put someone's correspondence in this repository permanently.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { composeDraft, draftRefusalMessage } from '../src/engine/email/draft.js';
import {
  GmailProvider,
  decodeBody,
  parseAddressList,
  toCanonicalMessage,
  toGmailQuery,
} from '../src/engine/email/gmailProvider.js';
import type { KnownContact } from '../src/engine/email/recipients.js';
import type { EmailMessage } from '../src/engine/email/types.js';

const CONTACTS: KnownContact[] = [
  { address: 'james@example.com', name: 'James Okafor', messageCount: 10 },
  { address: 'james.lee@other.com', name: 'James Lee', messageCount: 2 },
  { address: 'maria@example.com', name: 'Maria Santos', messageCount: 5 },
];

const source = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  providerMessageId: 'pm1',
  providerThreadId: 'pt1',
  from: { address: 'maria@example.com' },
  to: [{ address: 'owner@migrateck.com' }],
  cc: [],
  subject: 'Contract review',
  sentAt: '2026-09-05T10:00:00.000Z',
  snippet: 's',
  bodyComplete: true,
  textBody: 'Body',
  attachments: [],
  labels: [],
  unread: false,
  retrievedAt: '2026-09-08T12:00:00.000Z',
  ...over,
});

/* ------------------------------------------------------------------ *
 * 🚨 Threading by id
 * ------------------------------------------------------------------ */

test('🚨 a reply threads by ID, not by subject', () => {
  /*
   * "Re: invoice" appears on unrelated conversations. A reply threaded by
   * subject can land in a stranger's conversation and reach its participants —
   * the recipient-guessing failure arriving by a different route.
   */
  const result = composeDraft({ kind: 'reply', body: 'Thanks', source: source(), contacts: CONTACTS });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.inReplyToMessageId, 'pm1');
    assert.equal(result.draft.threadId, 'pt1');
  }
});

test('🚨 a FORWARD does not inherit the thread', () => {
  /*
   * A forward starts a new conversation. Attaching it to the original would
   * put the forwarded copy in front of the original participants — who were
   * never meant to see where it went.
   */
  const result = composeDraft({
    kind: 'forward',
    to: ['maria@example.com'],
    body: 'FYI',
    source: source(),
    contacts: CONTACTS,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.threadId, undefined);
    assert.equal(result.draft.inReplyToMessageId, undefined);
  }
});

test('a reply addresses the sender; a forward has no implied recipient', () => {
  const reply = composeDraft({ kind: 'reply', body: 'ok', source: source(), contacts: CONTACTS });
  assert.equal(reply.ok, true);
  if (reply.ok) assert.deepEqual(reply.draft.to.map((a) => a.address), ['maria@example.com']);

  const forward = composeDraft({ kind: 'forward', body: 'ok', source: source(), contacts: CONTACTS });
  assert.equal(forward.ok, false, 'a forward invented a recipient');
});

test('reply-all excludes the connected account', () => {
  // Replying to yourself is never intended, and including it silently doubles
  // the thread for everyone else.
  const result = composeDraft({
    kind: 'reply_all',
    body: 'ok',
    source: source({ to: [{ address: 'owner@migrateck.com' }, { address: 'james@example.com' }] }),
    contacts: CONTACTS,
    selfAddress: 'owner@migrateck.com',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    const addresses = result.draft.to.map((a) => a.address);
    assert.ok(!addresses.includes('owner@migrateck.com'), 'the sender addressed themselves');
    assert.ok(addresses.includes('maria@example.com'));
    assert.ok(addresses.includes('james@example.com'));
  }
});

test('subjects get one prefix, not two', () => {
  const reply = composeDraft({ kind: 'reply', body: 'x', source: source({ subject: 'RE: Contract' }), contacts: CONTACTS });
  assert.equal(reply.ok, true);
  if (reply.ok) assert.equal(reply.draft.subject, 'RE: Contract');
});

/* ------------------------------------------------------------------ *
 * 🚨 Recipient ambiguity
 * ------------------------------------------------------------------ */

test('🚨 an ambiguous recipient refuses composition', () => {
  // Asked while COMPOSING, so the user answers before approving something
  // addressed to a person they did not choose.
  const result = composeDraft({ kind: 'new', to: ['James'], subject: 'Hi', body: 'x', contacts: CONTACTS });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'recipients_unresolved');
});

test('the refusal names the candidates so the user can choose', () => {
  const result = composeDraft({ kind: 'new', to: ['James'], subject: 'Hi', body: 'x', contacts: CONTACTS });
  assert.equal(result.ok, false);
  if (!result.ok) {
    const message = draftRefusalMessage(result.refusal);
    assert.match(message, /james@example\.com/);
    assert.match(message, /james\.lee@other\.com/);
  }
});

test('🚨 ONE bad cc refuses the whole draft', () => {
  // Composing with the recipients we understood produces a draft the user
  // might approve without noticing someone is missing.
  const result = composeDraft({
    kind: 'new',
    to: ['maria@example.com'],
    cc: ['James'],
    subject: 'Hi',
    body: 'x',
    contacts: CONTACTS,
  });
  assert.equal(result.ok, false);
});

test('a reply without its source message is refused', () => {
  const result = composeDraft({ kind: 'reply', body: 'x', contacts: CONTACTS });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'source_missing');
});

test('a message with no recipient is refused', () => {
  const result = composeDraft({ kind: 'new', to: [], subject: 'Hi', body: 'x', contacts: CONTACTS });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'no_recipients');
});

/* ------------------------------------------------------------------ *
 * Gmail parsing — synthetic fixtures only
 * ------------------------------------------------------------------ */

test('address headers parse, including a quoted name containing a comma', () => {
  const parsed = parseAddressList('"Okafor, James" <james@example.com>, maria@example.com');
  assert.deepEqual(parsed.map((a) => a.address), ['james@example.com', 'maria@example.com']);
  assert.equal(parsed[0]!.name, 'Okafor, James');
});

test('an unparseable address header yields what it can, not nothing', () => {
  // Dropping a recipient silently is worse than an imperfect display name.
  const parsed = parseAddressList('garbage, real@example.com');
  assert.deepEqual(parsed.map((a) => a.address), ['real@example.com']);
});

test('base64url bodies decode; undecodable ones become ABSENT', () => {
  assert.equal(decodeBody(Buffer.from('hello there').toString('base64url')), 'hello there');
  assert.equal(decodeBody(undefined), undefined);
});

test('🚨 a metadata-only message is NOT bodyComplete', () => {
  /*
   * Gmail's `format=metadata` returns a snippet and no body. Labelling that
   * complete is precisely the failure the flag exists to prevent.
   */
  const message = toCanonicalMessage(
    { id: 'm1', threadId: 't1', snippet: 'A preview of the message…', payload: { headers: [{ name: 'Subject', value: 'Hi' }] } },
    '2026-09-08T12:00:00.000Z',
  );
  assert.ok(message);
  assert.equal(message.bodyComplete, false);
  assert.equal(message.textBody, undefined);
  assert.equal(message.snippet, 'A preview of the message…');
});

test('a full message with a nested text part IS bodyComplete', () => {
  const message = toCanonicalMessage(
    {
      id: 'm1',
      threadId: 't1',
      internalDate: '1788000000000',
      labelIds: ['INBOX', 'UNREAD'],
      snippet: 'preview',
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'From', value: 'Hetzner <billing@hetzner.com>' },
          { name: 'Subject', value: 'Invoice' },
        ],
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('The whole body.').toString('base64url') } }],
          },
          { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'a1', size: 2048 } },
        ],
      },
    },
    '2026-09-08T12:00:00.000Z',
  );
  assert.ok(message);
  assert.equal(message.bodyComplete, true);
  assert.equal(message.textBody, 'The whole body.');
  assert.equal(message.from.address, 'billing@hetzner.com');
  assert.equal(message.unread, true);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0]!.filename, 'invoice.pdf');
});

test('a message without an id is rejected rather than half-built', () => {
  assert.equal(toCanonicalMessage({ threadId: 't1' }, '2026-09-08T12:00:00.000Z'), null);
});

test('internalDate wins over a sender-supplied Date header', () => {
  // The Date header is sender-supplied and can be wrong or absent; Gmail sorts
  // by internalDate, so that is the source of truth.
  const message = toCanonicalMessage(
    {
      id: 'm1',
      threadId: 't1',
      internalDate: '1788000000000',
      payload: { headers: [{ name: 'Date', value: 'Tue, 1 Jan 1990 00:00:00 +0000' }] },
    },
    '2026-09-08T12:00:00.000Z',
  );
  assert.ok(message);
  assert.notEqual(new Date(message.sentAt).getFullYear(), 1990);
});

test('the Migra query becomes Gmail syntax, and that syntax stops here', () => {
  const q = toGmailQuery({
    from: 'hetzner.com',
    unreadOnly: true,
    hasAttachment: true,
    after: '2026-09-01T00:00:00Z',
    keywords: 'invoice',
    limit: 10,
  });
  assert.match(q, /from:hetzner\.com/);
  assert.match(q, /is:unread/);
  assert.match(q, /has:attachment/);
  assert.match(q, /after:2026\/09\/01/);
  assert.match(q, /invoice/);
});

/* ------------------------------------------------------------------ *
 * 🚨 Unconfigured
 * ------------------------------------------------------------------ */

test('🚨 with no credentials the adapter reports NOT CONFIGURED, and refuses everything', async () => {
  const gmail = new GmailProvider();
  const connection = await gmail.health();
  assert.equal(connection.state, 'not_configured');
  assert.equal(connection.scopes.read, false);

  for (const outcome of [
    await gmail.search({ limit: 5 }),
    await gmail.readMessage('m1'),
    await gmail.readThread('t1'),
    await gmail.listAttachments('m1'),
    await gmail.send({ to: [], cc: [], bcc: [], subject: '', body: '' }, 'k'),
  ]) {
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.failure.kind, 'not_configured');
  }
});

test('no credential ever appears in adapter output', () => {
  const gmail = new GmailProvider({ accessToken: 'ya29.SECRET-TOKEN-VALUE', accountAddress: 'a@b.com' });
  const serialised = JSON.stringify(gmail);
  assert.ok(!serialised.includes('SECRET-TOKEN-VALUE'), 'a token is reachable by serialising the adapter');
});
