/**
 * "THAT EMAIL" — resolved from what the conversation retrieved, and nothing else.
 *
 * 🚨 The implementations this rejects, and why each fails:
 *
 *   · remember the provider id in the browser — a provider id is not stable
 *     (Gmail regenerates attachment ids every read), and anything the browser
 *     sends is something a browser can INVENT;
 *   · resolve by searching the mailbox again — "that email" would then mean
 *     whatever a fresh search returns, not the message the user was shown;
 *   · key on conversation id alone — a conversation id is not a permission.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryConversationEvidence, referenceKind, referencePhrase, resolveReference,
} from '../src/engine/chat/conversationEvidence.js';
import { emailEvidence } from '../src/engine/grounding/typedEvidenceLedger.js';

const ALICE = { principalId: 'user:alice', workspaceId: 'personal:alice' };
const BOB = { principalId: 'user:bob', workspaceId: 'personal:bob' };

const mail = (id: string, over: Record<string, unknown> = {}) => emailEvidence({
  id, scope: ALICE,
  providerMessageId: `pm-${id}`, providerThreadId: `pt-${id}`,
  subject: `Subject ${id}`, from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
  text: `Body of ${id}`, complete: true,
  ...over,
} as Parameters<typeof emailEvidence>[0]);

const record = (items: ReturnType<typeof mail>[], scope = ALICE, turn = 't1') => ({
  conversationId: 'c1', turnId: turn, scope, items,
  // Which capability retrieved each item. A later turn re-invokes THAT one, so
  // an unattributed item is not a candidate at all.
  producedBy: Object.fromEntries(items.map((i) => [i.id, 'migra.email'])),
});

/* ------------------------------------------------------------------ *
 * 🚨 Recognising a BACKWARD reference
 * ------------------------------------------------------------------ */

test('🚨 a backward reference is recognised; a fresh request is NOT', () => {
  /*
   * "the email from Hetzner" is a fresh search. Treating it as a reference
   * would answer from stale evidence instead of looking.
   */
  assert.equal(referencePhrase('summarize that email'), 'that email');
  assert.equal(referencePhrase('summarize the thread'), 'the thread');
  /*
   * Two backward phrases overlap here — "the spreadsheet" and "attached to it".
   * Which one is reported does not matter and asserting a winner would pin an
   * arbitrary preference; what matters is that the sentence IS recognised as a
   * reference. The KIND test below is the one with meaning.
   */
  assert.ok(referencePhrase('what values are in the spreadsheet attached to it?'));

  assert.equal(referencePhrase('find the email containing MIGRA_EMAIL_SENTINEL_0909'), null);
  assert.equal(referencePhrase('search my email for invoices'), null);
});

test('a longer phrase beats a shorter one contained in it', () => {
  // The bare "it" must not win over a phrase that contains it, or every
  // sentence with "it" in it becomes a reference.
  assert.notEqual(referencePhrase('open the spreadsheet attached to it'), 'it');
  assert.ok((referencePhrase('open the spreadsheet attached to it') ?? '').length > 2);
});

test('the reference kind distinguishes a message, a thread and an attachment', () => {
  assert.equal(referenceKind('summarize that email'), 'email');
  assert.equal(referenceKind('summarize the thread'), 'thread');
  assert.equal(referenceKind('what values are in the XLSX attached to that email?'), 'attachment');
  assert.equal(referenceKind('open the spreadsheet attached to it'), 'attachment');
});

/* ------------------------------------------------------------------ *
 * 🚨 Case 10 — resolution through canonical evidence
 * ------------------------------------------------------------------ */

test('🚨 10. "that email" resolves to the evidence the conversation retrieved', () => {
  const ref = resolveReference({
    prompt: 'summarize that email',
    history: [record([mail('email_1')])],
    scope: ALICE,
  });
  assert.ok(ref, 'the reference did not resolve');
  assert.equal(ref!.item.id, 'email_1');
  assert.equal(ref!.kind, 'email');
});

test('🚨 10b. the NEWEST evidence wins — "that email" means the one just shown', () => {
  const ref = resolveReference({
    prompt: 'summarize that email',
    history: [record([mail('email_1')], ALICE, 't1'), record([mail('email_2')], ALICE, 't2')],
    scope: ALICE,
  });
  assert.equal(ref!.item.id, 'email_2', 'an older message was resolved as "that email"');
});

test('🚨 evidence with NO recorded producer is not a candidate at all', () => {
  /*
   * 🚨 THERE IS NO DEFAULT CAPABILITY. Resolving a reference means re-invoking
   * whatever retrieved it, so an item with no recorded producer offers only
   * two ways forward and both are wrong: guess a capability, or serve the
   * stored text back — which is a pointer becoming a permission.
   *
   * A record written before attribution existed lands here, and refusing to
   * resolve it is the safe half of that migration.
   */
  const orphaned = { ...record([mail('email_1')]), producedBy: {} };
  const ref = resolveReference({ prompt: 'summarize that email', history: [orphaned], scope: ALICE });

  assert.equal(ref, null, 'a reference resolved against evidence with no known producer');
});

test('🚨 10c. with nothing retrieved, the reference does NOT resolve', () => {
  /*
   * Must be null, not a mailbox search. "That email" with no antecedent is a
   * question to ask back, not a licence to go looking.
   */
  assert.equal(resolveReference({ prompt: 'summarize that email', history: [], scope: ALICE }), null);
});

/* ------------------------------------------------------------------ *
 * 🚨 Case 3 — the attachment continuation
 * ------------------------------------------------------------------ */

test('🚨 3. "the XLSX attached to that email" resolves to the MESSAGE that carries it', () => {
  /*
   * The attachment may not have been fetched yet. The message is what lets the
   * next step go and find it — by our STABLE ref, never a provider id.
   */
  const ref = resolveReference({
    prompt: 'What are the values in the XLSX attached to that email?',
    history: [record([mail('email_1')])],
    scope: ALICE,
  });
  assert.ok(ref);
  assert.equal(ref!.kind, 'attachment');
  assert.equal(ref!.item.locator.providerMessageId, 'pm-email_1');
});

test('an already-fetched attachment resolves to itself, by its stable ref', () => {
  const attachment = mail('att_1', { attachmentRef: 'ref-abc', subject: 'Invoice' });
  const ref = resolveReference({
    prompt: 'what is in the spreadsheet?',
    history: [record([mail('email_1'), attachment])],
    scope: ALICE,
  });
  assert.equal(ref!.item.id, 'att_1');
  assert.equal(ref!.item.locator.attachmentRef, 'ref-abc');
});

/* ------------------------------------------------------------------ *
 * 🚨 Scope — a conversation id is not a permission
 * ------------------------------------------------------------------ */

test('🚨 another principal cannot resolve a reference in the same conversation', () => {
  const ref = resolveReference({
    prompt: 'summarize that email',
    history: [record([mail('email_1')], ALICE)],
    scope: BOB,
  });
  assert.equal(ref, null, 'another principal resolved someone else\'s evidence');
});

test('🚨 the STORE refuses to return another principal\'s turns', async () => {
  const store = new MemoryConversationEvidence();
  await store.append(record([mail('email_1')], ALICE));

  assert.equal((await store.recent('c1', ALICE, 10)).length, 1);
  assert.equal((await store.recent('c1', BOB, 10)).length, 0, 'a conversation id acted as a permission');
});

test('🚨 no provider id is required from the caller to resolve a reference', async () => {
  /*
   * The whole point: the caller says "that email". Nothing it sends names a
   * message, so nothing it sends can name someone else's.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const source = readFileSync(join(process.cwd(), 'src/engine/chat/conversationEvidence.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Resolution reads history and scope. It must not accept an id from outside.
  assert.ok(!/providerMessageId\s*:\s*string/.test(code.split('export function resolveReference')[1] ?? ''),
    'resolveReference takes a provider id from its caller');
  assert.match(source, /history: readonly ConversationEvidenceRecord\[\]/);
});

/* ------------------------------------------------------------------ *
 * 🚨 Punctuation must not hide a reference
 * ------------------------------------------------------------------ */

test('🚨 a reference is found whatever punctuation follows it', () => {
  /*
   * 🚨 REGRESSION FROM A LIVE FAILURE. Matching required a space, a `?` or a
   * `.` after the phrase. "Who sent that email, and what is its subject line?"
   * has a COMMA — so the reference did not resolve and the turn searched
   * instead.
   *
   * The answer still came out correct, which is what makes it dangerous: the
   * model wrote it from the previous turn's summary. Disconnect the mailbox in
   * between and the same sentence appears, produced from remembered prose with
   * nothing checking whether the user may still see it.
   */
  for (const prompt of [
    'who sent that email, and what is its subject line?',
    'summarize that email; then tell me the total',
    'about that email — who sent it?',
    'what does "that email" say?',
    'summarize that email!',
    'that email\'s sender?',
  ]) {
    assert.equal(referencePhrase(prompt), 'that email', `not recognised: ${prompt}`);
  }
});

test('a word that merely CONTAINS a phrase is not a reference', () => {
  // Normalising punctuation must not turn matching into substring matching.
  assert.equal(referencePhrase('rethatemail the archive'), null);
});
