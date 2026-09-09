/**
 * UNKNOWN IS NOT EMPTY.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT, OBSERVED AGAINST A LIVE MAILBOX
 *
 * Attachment ids live in the provider's MIME tree. A `format=metadata` read
 * does not carry one — so a search result's `attachments` array was empty
 * whether the message had none or had five, and every search this product ever
 * ran reported "no attachments" without having looked.
 *
 * It was caught during live qualification only because the run stopped trusting
 * search and re-checked with a full read.
 *
 * ---------------------------------------------------------------------------
 * WHY A FLAG AND NOT AN ABSENT FIELD
 *
 * Omission was rejected deliberately: a missing field also means "old client",
 * "serialisation bug" or "not requested", and it leaves every caller inferring
 * semantics from field presence. `bodyComplete` settled the same argument for
 * bodies. Unknown must be EXPLICIT.
 *
 *   attachmentsKnown: false                   presence UNKNOWN — say nothing
 *   attachmentsKnown: true,  attachments: []  inspection PROVED none
 *   attachmentsKnown: true,  attachments: [x] inspection PROVED these
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GmailProvider, toCanonicalMessage } from '../src/engine/email/gmailProvider.js';

/* ------------------------------------------------------------------ *
 * A transport that answers differently for metadata and full reads
 * ------------------------------------------------------------------ */

interface RawGmail {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: Record<string, unknown>;
}

const WITH_ATTACHMENT: RawGmail = {
  id: 'm-att', threadId: 't1', labelIds: ['INBOX'], snippet: 'See attached.',
  internalDate: '1757404800000',
  payload: {
    mimeType: 'multipart/mixed',
    headers: [{ name: 'Subject', value: 'Invoice' }, { name: 'From', value: 'billing@example.com' }],
    parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from('See attached.').toString('base64url') } },
      { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId: 'att1', size: 2048 } },
    ],
  },
};

const NO_ATTACHMENT: RawGmail = {
  id: 'm-plain', threadId: 't2', labelIds: ['INBOX'], snippet: 'Just text.',
  internalDate: '1757404800000',
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'Subject', value: 'Plain' }, { name: 'From', value: 'a@example.com' }],
    body: { data: Buffer.from('Just text.').toString('base64url') },
  },
};

/**
 * The metadata projection Gmail actually returns: headers and a snippet, and
 * NO parts — which is the entire reason presence cannot be claimed from it.
 */
const metadataOf = (full: RawGmail) => ({
  id: full.id,
  threadId: full.threadId,
  labelIds: full.labelIds,
  snippet: full.snippet,
  internalDate: full.internalDate,
  payload: { headers: (full.payload as { headers: unknown }).headers },
});

function providerFor(messages: RawGmail[]) {
  const calls: string[] = [];
  const fake = async (input: unknown): Promise<unknown> => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/threads/')) {
      // Gmail returns the thread's messages in FULL here, which is why a thread
      // read is authoritative.
      const id = url.split('/threads/')[1]!.split('?')[0]!;
      return {
        ok: true, status: 200,
        json: async () => ({ id, messages: messages.filter((m) => m.threadId === id) }),
      };
    }
    if (url.includes('/messages/')) {
      const id = url.split('/messages/')[1]!.split('?')[0]!;
      const full = messages.find((m) => m.id === id);
      if (!full) return { ok: false, status: 404, json: async () => ({}) };
      const isMetadata = url.includes('format=metadata');
      return { ok: true, status: 200, json: async () => (isMetadata ? metadataOf(full) : full) };
    }
    return {
      ok: true, status: 200,
      json: async () => ({ messages: messages.map((m) => ({ id: m.id })) }),
    };
  };
  const provider = new GmailProvider({
    accessToken: 'ya29.token',
    scopes: { read: true, draft: false, send: false },
    fetch: fake as unknown as typeof globalThis.fetch,
    baseUrl: 'https://gmail.test/v1/users/me',
  });
  return { provider, calls };
}

/* ------------------------------------------------------------------ *
 * 1. Metadata search cannot claim "no attachments"
 * ------------------------------------------------------------------ */

test('🚨 1. a metadata SEARCH reports attachmentsKnown:false, even for a message that HAS one', async () => {
  /*
   * The sharpest form of the defect: the message genuinely has a PDF, and the
   * search result's empty array would have said otherwise.
   */
  const { provider, calls } = providerFor([WITH_ATTACHMENT]);
  const outcome = await provider.search({ limit: 5 });

  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  assert.ok(calls.some((c) => c.includes('format=metadata')), 'search did not use the metadata projection');
  const [message] = outcome.value;
  assert.equal(message!.attachmentsKnown, false, 'a metadata read claimed to know about attachments');
  assert.deepEqual(message!.attachments, [], 'the list is empty because nothing was inspected');
});

/* ------------------------------------------------------------------ *
 * 2 + 3. A full read is authoritative, in both directions
 * ------------------------------------------------------------------ */

test('🚨 2. a FULL read of a message with no attachment is KNOWN-EMPTY', async () => {
  const { provider } = providerFor([NO_ATTACHMENT]);
  const outcome = await provider.readMessage('m-plain');

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value.attachmentsKnown, true, 'a full read must be authoritative');
    assert.deepEqual(outcome.value.attachments, [], 'proven absence');
  }
});

test('🚨 3. a FULL read of a message WITH an attachment is KNOWN-NONEMPTY', async () => {
  const { provider } = providerFor([WITH_ATTACHMENT]);
  const outcome = await provider.readMessage('m-att');

  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value.attachmentsKnown, true);
    assert.deepEqual(outcome.value.attachments.map((a) => a.filename), ['invoice.pdf']);
  }
});

test('a thread read is authoritative too — it fetches full messages', async () => {
  const { provider } = providerFor([WITH_ATTACHMENT]);
  const outcome = await provider.readThread('t1');
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.ok(outcome.value.messages.every((m) => m.attachmentsKnown === true),
      'a thread message was left in the unknown state');
  }
});

/* ------------------------------------------------------------------ *
 * 4. listAttachments is always authoritative
 * ------------------------------------------------------------------ */

test('🚨 4. listAttachments reads the FULL tree, so its answer is always known', async () => {
  const { provider, calls } = providerFor([NO_ATTACHMENT]);
  const outcome = await provider.listAttachments('m-plain');

  assert.equal(outcome.ok, true);
  assert.ok(calls.some((c) => c.includes('format=full')), 'listAttachments used a metadata projection');
  assert.ok(!calls.some((c) => c.includes('format=metadata')), 'listAttachments must never answer from metadata');

  // And the capability states it rather than leaving it to be inferred.
  const registry = readFileSync(join(process.cwd(), 'src/engine/models/capabilityRegistry.ts'), 'utf8');
  assert.match(registry, /attachmentsKnown: true, attachments: result\.attachments/,
    'the listAttachments response does not declare its own authority');
});

/* ------------------------------------------------------------------ *
 * 5. Nobody may promote unknown to empty
 * ------------------------------------------------------------------ */

test('🚨 5. no summariser, planner or UI turns an unknown attachment state into "none"', async () => {
  /*
   * Asserted against the SOURCE, because the guarantee is that certain code
   * does not exist. Every legitimate read of `.attachments` is on a value the
   * provider produced from a FULL read; a read anywhere else would be a caller
   * deciding "empty means none" without having looked.
   */
  const root = process.cwd();
  const src = (rel: string) => readFileSync(join(root, rel), 'utf8');

  // The summariser and the evidence layer must not reach attachments at all.
  for (const rel of ['src/engine/email/emailSummary.ts', 'src/engine/email/evidence.ts']) {
    const code = src(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.ok(!/\.attachments\b/.test(code), `${rel} reads attachments and could report unknown as none`);
  }

  /*
   * Where attachments ARE read, the value came from a full read. Listed
   * explicitly so a NEW reader has to be added here deliberately rather than
   * appearing unnoticed.
   */
  const permitted = [
    'src/engine/email/gmailProvider.ts',   // listAttachments + readAttachment, both format=full
    'src/engine/email/emailExecution.ts',  // ingest, from readMessage (full)
  ];
  const { execSync } = await import('node:child_process');
  const hits = execSync(
    "grep -rln '\\.attachments' src/engine/email || true",
    { cwd: root, encoding: 'utf8' },
  ).split('\n').filter(Boolean);

  for (const file of hits) {
    assert.ok(permitted.includes(file), `${file} reads attachments without being a full-read path`);
  }
});

/* ------------------------------------------------------------------ *
 * 6. bodyComplete is untouched
 * ------------------------------------------------------------------ */

test('🚨 6. bodyComplete semantics are completely independent of attachmentsKnown', async () => {
  /*
   * Two different unknowns about the same message. Folding them into one flag
   * is precisely the mistake this file exists to prevent being made twice.
   */
  const { provider } = providerFor([WITH_ATTACHMENT]);

  const search = await provider.search({ limit: 5 });
  const read = await provider.readMessage('m-att');
  assert.equal(search.ok, true);
  assert.equal(read.ok, true);
  if (!search.ok || !read.ok) return;

  // Metadata: neither known. Full: both known. They move together HERE, so the
  // independence is asserted on the constructor, where they can disagree.
  assert.equal(search.value[0]!.bodyComplete, false);
  assert.equal(search.value[0]!.attachmentsKnown, false);
  assert.equal(read.value.bodyComplete, true);
  assert.equal(read.value.attachmentsKnown, true);

  // A body we could not decode, on a tree we DID inspect: attachments known,
  // body incomplete. One flag could not express this.
  const bodiless = toCanonicalMessage(
    { id: 'x', threadId: 'y', snippet: 'preview', payload: { headers: [], parts: [
      { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'z', size: 1 } },
    ] } } as never,
    '2026-09-09T00:00:00Z',
    true,
  )!;
  assert.equal(bodiless.bodyComplete, false, 'no text body was decoded');
  assert.equal(bodiless.attachmentsKnown, true, 'but the tree WAS inspected');
  assert.equal(bodiless.attachments.length, 1);
});

/* ------------------------------------------------------------------ *
 * 7. The default must not drift back to "known"
 * ------------------------------------------------------------------ */

test('🚨 7. toCanonicalMessage DEFAULTS to unknown, so a forgetful caller understates', async () => {
  /*
   * The mutation this guards: making the parameter default to true, or dropping
   * it, which silently restores "every search claims no attachments".
   */
  const message = toCanonicalMessage(WITH_ATTACHMENT as never, '2026-09-09T00:00:00Z')!;
  assert.equal(message.attachmentsKnown, false,
    'the default asserts knowledge the caller never claimed to have');

  // Explicit false is still false; explicit true is honoured.
  assert.equal(toCanonicalMessage(WITH_ATTACHMENT as never, '2026-09-09T00:00:00Z', false)!.attachmentsKnown, false);
  assert.equal(toCanonicalMessage(WITH_ATTACHMENT as never, '2026-09-09T00:00:00Z', true)!.attachmentsKnown, true);
});
