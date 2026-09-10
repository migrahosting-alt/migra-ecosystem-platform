/**
 * "GMAIL RETURNED THIS MESSAGE" IS NOT "THE MESSAGE SAYS THIS".
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE OWNER ACCEPTANCE FAILURE, PINNED
 *
 * Asked to find the email containing `MIGRA_EMAIL_SENTINEL_0909`, Gmail
 * returned exactly one message — because Gmail indexes ATTACHMENT CONTENT. The
 * sentinel was in a spreadsheet. It was in neither the snippet, the subject,
 * nor the full body (verified against the live mailbox: `bodyComplete: true`,
 * 140 characters, no sentinel).
 *
 * So every claim that the message contained it was unsupported, the gate
 * removed all of them — correctly — and the user was told nothing was found,
 * about a search that had found precisely the right message.
 *
 * The bridge is not to relax the gate. It is to go and READ the attachment, so
 * that whatever is said afterwards is said about a document the turn actually
 * has.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCapabilityTurn } from '../src/engine/chat/capabilityTurn.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { executionIdentityFrom } from '../src/engine/identity/executionIdentity.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';

const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const MAIL = { id: 'migra.email', nouns: ['email', 'mail', 'message', 'inbox', 'thread'], available: true };
const SENTINEL = 'MIGRA_EMAIL_SENTINEL_0909';

function locate(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`fixture not found: ${relative}`);
}
const WORKBOOK = readFileSync(locate('packages/shared-types/src/workbook/__fixtures__/workbook_basic.xlsx'));

/**
 * The live message, reproduced faithfully: the body is COMPLETE and does not
 * contain the sentinel anywhere.
 */
const message = () => ({
  providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
  from: { address: 'migrateck@gmail.com' }, to: [], cc: [],
  subject: 'test file', sentAt: '2026-09-09T21:00:16.000Z',
  snippet: 'here s the test files -- 4957 Coconut Creek Pkwy',
  textBody: 'here s the test files -- 4957 Coconut Creek Pkwy',
  // 🚨 A SEARCH RESULT DOES NOT KNOW. That is why the listing has to happen.
  bodyComplete: false, attachmentsKnown: false, attachments: [],
  labels: ['INBOX'], unread: true, retrievedAt: '2026-09-10T00:00:00Z',
});

interface Call { op: string; attachmentId?: string; keywords?: string }

function deps(o: {
  calls: Call[];
  attachments?: Array<{ ref: string; filename: string; carriesSentinel?: boolean }>;
  results?: number;
}) {
  const listed = o.attachments ?? [
    { ref: 'ref-pdf', filename: 'migrapilot_email_fixture.pdf' },
    { ref: 'ref-xlsx', filename: 'migrapilot_email_fixture.xlsx', carriesSentinel: true },
  ];

  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async (input: unknown) => {
          const req = input as { op?: string; attachmentId?: string; keywords?: string };
          const op = String(req.op ?? 'search');
          o.calls.push({ op, attachmentId: req.attachmentId, keywords: req.keywords });

          if (op === 'listAttachments') {
            return {
              ok: true, attachmentsKnown: true,
              attachments: listed.map((a) => ({
                ref: a.ref, filename: a.filename,
                mimeType: a.filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.ms-excel',
                size: WORKBOOK.length,
              })),
            };
          }
          if (op === 'fetchAttachment') {
            const found = listed.find((a) => a.ref === req.attachmentId);
            if (!found) return { ok: false, failure: { kind: 'not_found' } };
            /*
             * A PDF here yields bytes the extractor cannot read, which is the
             * honest shape: an attachment that cannot be opened contributes no
             * evidence and the search continues to the next one.
             */
            const bytes = found.carriesSentinel
              ? new TextEncoder().encode(`Sentinel\t${SENTINEL}\nFixture Value 1\t48273.55`)
              : new TextEncoder().encode('not a readable document');
            return {
              ok: true,
              file: {
                filename: found.carriesSentinel ? 'fixture.csv' : found.filename,
                mimeType: 'text/csv',
                bytes,
                provenance: {
                  source: 'email', providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
                  attachmentRef: found.ref, providerAttachmentId: 'EPHEMERAL',
                  messageEvidenceId: 'me-1', attachmentEvidenceId: 'ae-1',
                },
              },
            };
          }
          const count = o.results ?? 1;
          return { ok: true, messages: Array.from({ length: count }, () => message()) };
        },
      };
    }
  }
  const readinessFor = async (): Promise<ReadinessContext> => ({
    mail: { state: 'connected', account: 'qa@x.com', scopes: { read: true, draft: false, send: false }, checkedAt: 'T' },
  });
  return {
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
    capabilities: [MAIL],
    evidence: new MemoryConversationEvidence(),
  };
}

const ask = (prompt: string, d: ReturnType<typeof deps>) => runCapabilityTurn({
  prompt,
  identity: executionIdentityFrom(ALICE),
  conversationId: 'c1', turnId: 't1', requestId: 'r1',
}, d);

/* ------------------------------------------------------------------ *
 * 🚨 The acceptance turn itself
 * ------------------------------------------------------------------ */

test(`🚨 the exact acceptance prompt now finds where ${SENTINEL} really is`, async () => {
  const calls: Call[] = [];
  const d = deps({ calls });

  const result = await ask(`Find the email about containing ${SENTINEL}`, d);

  // The provider matched; our message evidence did not carry the term; the turn
  // went and opened the attachments rather than answering from a body that
  // never mentioned it.
  assert.deepEqual(calls.map((c) => c.op), ['search', 'listAttachments', 'fetchAttachment', 'fetchAttachment']);
  assert.equal(calls[0]!.keywords, SENTINEL.toLowerCase());

  const match = result.providerMatchBeyondEvidence;
  assert.ok(match, 'the turn did not notice the provider matched something it could not see');
  assert.equal(match!.located, true, `the sentinel was never located: ${JSON.stringify(match)}`);

  // 🚨 AND IT IS IN FILE EVIDENCE, so a claim about it is a claim about a
  // document that was actually read.
  const files = result.ledger.ofKind('file');
  assert.ok(files.some((f) => f.text.includes(SENTINEL)), 'the sentinel is not in any retrieved file');
});

test('🚨 it stops as soon as the term is in front of it', async () => {
  const calls: Call[] = [];
  // The readable one first: there is then no reason to open the second.
  const d = deps({
    calls,
    attachments: [
      { ref: 'ref-xlsx', filename: 'fixture.xlsx', carriesSentinel: true },
      { ref: 'ref-pdf', filename: 'other.pdf' },
    ],
  });

  await ask(`Find the email about containing ${SENTINEL}`, d);

  assert.equal(calls.filter((c) => c.op === 'fetchAttachment').length, 1,
    'a second attachment was downloaded after the term had already been found');
});

/* ------------------------------------------------------------------ *
 * 🚨 It stays narrow
 * ------------------------------------------------------------------ */

test('🚨 an ordinary search whose terms ARE in the message costs no extra read', async () => {
  const calls: Call[] = [];
  const d = deps({ calls });

  const result = await ask('search my email for the test files', d);

  assert.deepEqual(calls.map((c) => c.op), ['search'], 'an ordinary search opened attachments');
  assert.equal(result.providerMatchBeyondEvidence, null);
});

test('🚨 more than one result does NOT trigger a sweep', async () => {
  const calls: Call[] = [];
  const d = deps({ calls, results: 3 });

  const result = await ask(`Find the email about containing ${SENTINEL}`, d);

  // Which of three messages matched on an attachment is not knowable from the
  // result, and opening every attachment of every hit is a download sweep of
  // the user's mail.
  assert.deepEqual(calls.map((c) => c.op), ['search']);
  assert.equal(result.providerMatchBeyondEvidence, null);
});

test('🚨 when nothing readable holds the term, it says so rather than guessing', async () => {
  const calls: Call[] = [];
  const d = deps({
    calls,
    attachments: [{ ref: 'ref-pdf', filename: 'scan.pdf' }],
  });

  const result = await ask(`Find the email about containing ${SENTINEL}`, d);

  const match = result.providerMatchBeyondEvidence;
  assert.ok(match);
  assert.equal(match!.located, false, 'the term was reported as located when it was not');
  assert.deepEqual(match!.inspected, ['scan.pdf']);
  // 🚨 AND NO EVIDENCE WAS INVENTED FOR IT. The claim stays ungroundable, which
  // is correct — the provider's match is not a substitute for reading.
  assert.equal(result.ledger.ofKind('file').some((f) => f.text.includes(SENTINEL)), false);
});
