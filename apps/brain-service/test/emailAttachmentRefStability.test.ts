/**
 * THE PROVIDER'S ATTACHMENT ID IS NOT AN IDENTIFIER.
 *
 * ---------------------------------------------------------------------------
 * 🚨 MEASURED AGAINST A LIVE MAILBOX
 *
 * Gmail regenerates `attachmentId` on EVERY `messages.get`. Two reads of the
 * same immutable message return two different 404-character blobs. So the
 * obvious design — list the attachments, hand the id back, fetch by that id —
 * returns `not_found` every single time, and the failure looks like a missing
 * attachment rather than an expired token.
 *
 * Two defects, both invisible to fixtures that invent short stable ids:
 *
 *   1. the capability capped attachment ids at 200 characters; real ones are 404
 *   2. list-then-fetch matched on a value the provider had already replaced
 *
 * The product now hands out a reference derived from what does NOT change, and
 * resolves it to whatever ephemeral id appears on the read that fetches bytes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GmailProvider } from '../src/engine/email/gmailProvider.js';
import { EmailSearchRequestSchema } from '../src/engine/models/capabilityRegistry.js';

/** A Gmail id of the length really observed: 404 characters. */
const realisticId = (seed: string) => (seed + 'x').repeat(404).slice(0, 404);

function messageWith(attachmentId: string) {
  return {
    id: 'm1', threadId: 't1', labelIds: ['INBOX'], snippet: 's',
    internalDate: '1757404800000',
    payload: {
      mimeType: 'multipart/mixed',
      headers: [{ name: 'Subject', value: 'Fixture' }],
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('body').toString('base64url') } },
        { mimeType: 'application/pdf', filename: 'invoice.pdf', body: { attachmentId, size: 27194 } },
      ],
    },
  };
}

/** Answers with a DIFFERENT provider id on every read, exactly like Gmail. */
function churningProvider() {
  let reads = 0;
  const seen: string[] = [];
  const fake = async (input: unknown): Promise<unknown> => {
    const url = String(input);
    if (url.includes('/attachments/')) {
      seen.push(decodeURIComponent(url.split('/attachments/')[1]!));
      return { ok: true, status: 200, json: async () => ({ data: Buffer.from('%PDF-1.4 bytes').toString('base64url') }) };
    }
    reads += 1;
    return { ok: true, status: 200, json: async () => messageWith(realisticId(String(reads))) };
  };
  const provider = new GmailProvider({
    accessToken: 'ya29.t', scopes: { read: true, draft: false, send: false },
    fetch: fake as unknown as typeof globalThis.fetch,
    baseUrl: 'https://gmail.test/v1/users/me',
  });
  return { provider, seen, reads: () => reads };
}

/* ------------------------------------------------------------------ */

test('🚨 our ref is STABLE across reads while the provider id churns', async () => {
  const { provider } = churningProvider();

  const first = await provider.listAttachments('m1');
  const second = await provider.listAttachments('m1');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;

  const a = first.value[0]!, b = second.value[0]!;
  assert.equal(a.ref, b.ref, 'the stable ref changed between reads');
  assert.notEqual(a.providerAttachmentId, b.providerAttachmentId,
    'the fixture must reproduce Gmail regenerating its id, or this proves nothing');
});

test('🚨 list-then-fetch WORKS even though the id changed in between', async () => {
  /*
   * The exact live failure: a ref captured from a listing, used on a later
   * fetch, against a provider that has since replaced its own id.
   */
  const { provider, seen } = churningProvider();

  const listed = await provider.listAttachments('m1');
  assert.equal(listed.ok, true);
  if (!listed.ok) return;
  const ref = listed.value[0]!.ref;
  const staleProviderId = listed.value[0]!.providerAttachmentId;

  const fetched = await provider.readAttachment('m1', ref);
  assert.equal(fetched.ok, true, 'list-then-fetch failed the way it did against the live mailbox');
  if (fetched.ok) assert.equal(fetched.value.filename, 'invoice.pdf');

  // The id actually sent to the provider came from the FETCH's own read.
  assert.equal(seen.length, 1);
  assert.notEqual(seen[0], staleProviderId, 'a stale provider id was sent to the API');
});

test('🚨 a provider token is REJECTED as a ref — only our handle resolves', async () => {
  // Passing the provider's own id must not work by accident, or the two
  // identifier spaces quietly merge again.
  const { provider } = churningProvider();
  const listed = await provider.listAttachments('m1');
  assert.equal(listed.ok, true);
  if (!listed.ok) return;

  const outcome = await provider.readAttachment('m1', listed.value[0]!.providerAttachmentId);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.failure.kind, 'not_found');
});

test('🚨 the capability accepts an id of the length a real provider emits', async () => {
  /*
   * The cap was 200. Real Gmail ids are 404, so every genuine attachment was
   * refused as INVALID_INPUT before the provider was ever called — a limit of
   * ours, reported as a fault of the caller's.
   */
  const long404 = realisticId('a');
  assert.equal(long404.length, 404);

  const ok = EmailSearchRequestSchema.safeParse({
    op: 'fetchAttachment', messageId: 'm1', attachmentId: long404,
  });
  assert.equal(ok.success, true, 'a realistic provider-length id was rejected by the schema');

  // Still bounded — an unbounded id is an unbounded log line.
  const absurd = EmailSearchRequestSchema.safeParse({
    op: 'fetchAttachment', messageId: 'm1', attachmentId: 'z'.repeat(4096),
  });
  assert.equal(absurd.success, false, 'the id length is unbounded');
});

test('🚨 provenance records a handle that still resolves later', async () => {
  /*
   * Provenance carrying only the provider id would name something that no
   * longer exists by the time anyone reads it — traceability in name only.
   */
  const bridge = readFileSync(join(process.cwd(), 'src/engine/email/attachmentBridge.ts'), 'utf8');
  assert.match(bridge, /attachmentRef: string;/, 'provenance has no re-fetchable handle');
  assert.match(bridge, /attachmentRef: evidence\.ref,/, 'the handle is declared but never populated');
});
