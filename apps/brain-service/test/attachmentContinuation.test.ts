/**
 * CASE 3 — "what does the spreadsheet attached to that email say?"
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE WHOLE PATH, WITH A REAL WORKBOOK AT THE END OF IT
 *
 *   resolved email evidence
 *     → OUR stable attachment ref (never the provider's, which Gmail
 *       regenerates on every read)
 *     → migra.email { op: fetchAttachment }
 *     → the canonical file pipeline
 *     → file evidence
 *     → extraction
 *     → exact spreadsheet values, through the SHARED verifier
 *
 * The workbook is the one real-Excel fixture the reader is qualified against,
 * so the values asserted below are values a spreadsheet application actually
 * wrote — not a hand-built XML string that agrees with my own parser.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCapabilityTurn } from '../src/engine/chat/capabilityTurn.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { executionIdentityFrom } from '../src/engine/identity/executionIdentity.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { verifyAnswer } from '../src/engine/grounding/claimVerifier.js';
import type { FileEvidence } from '../src/engine/grounding/evidenceTypes.js';

const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const MAIL = { id: 'migra.email', nouns: ['email', 'mail', 'message', 'inbox', 'thread'], available: true };

/*
 * Found by walking up rather than by a fixed relative path: this file runs both
 * from `src/` under tsx and from `dist/` after a build, and those are different
 * depths. A hardcoded `../../..` works in exactly one of them.
 */
const WORKBOOK = readFileSync(locate('packages/shared-types/src/workbook/__fixtures__/workbook_basic.xlsx'));

function locate(relative: string): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let up = 0; up < 8; up += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`fixture not found: ${relative}`);
}

/**
 * 🚨 THE PROVIDER'S ATTACHMENT ID. It exists, the provider needs it, and it
 * must never appear in anything we persist — it is regenerated on the next
 * `messages.get` and by then it names nothing.
 */
const PROVIDER_ATTACHMENT_ID = 'ANGjdJ_EPHEMERAL_TOKEN_0909';
/** OUR ref, derived from the attachment's own properties. Survives re-reads. */
const OUR_REF = 'a1b2c3d4e5f6a7b8c9d0e1f2';

const message = () => ({
  providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
  from: { address: 'billing@hetzner.com' }, to: [], cc: [],
  subject: 'Invoice 2026-09', sentAt: '2026-09-01T10:00:00Z',
  snippet: 'Your September invoice…',
  textBody: 'September invoice attached.',
  bodyComplete: true, attachmentsKnown: true,
  attachments: [{ ref: OUR_REF, filename: 'regions.xlsx', mimeType: 'application/vnd.ms-excel', size: WORKBOOK.length }],
  labels: ['INBOX'], unread: false, retrievedAt: '2026-09-09T00:00:00Z',
});

interface Call { op: string; principal?: string; attachmentId?: string }

function deps(o: {
  connectedFor: string[];
  calls: Call[];
  store: MemoryConversationEvidence;
  attachments?: Array<{ ref: string; filename: string }>;
  bytes?: Buffer;
  /** Simulates a capability that lists without saying whether it looked. */
  withholdKnown?: boolean;
}) {
  const listed = o.attachments ?? [{ ref: OUR_REF, filename: 'regions.xlsx' }];

  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async (input: unknown, ctx?: { principal?: { owner: string } }) => {
          const req = input as { op?: string; attachmentId?: string };
          const op = String(req.op ?? 'search');
          o.calls.push({ op, principal: ctx?.principal?.owner, attachmentId: req.attachmentId });

          if (op === 'listAttachments') {
            // 🚨 Always known: a listing reads the whole MIME tree.
            return {
              ok: true,
              ...(o.withholdKnown ? {} : { attachmentsKnown: true }),
              attachments: listed.map((a) => ({
                ref: a.ref, filename: a.filename,
                mimeType: 'application/vnd.ms-excel', size: WORKBOOK.length,
              })),
            };
          }
          if (op === 'fetchAttachment') {
            const found = listed.find((a) => a.ref === req.attachmentId);
            // An id that is not on this message is a refusal, never a fetch.
            if (!found) return { ok: false, failure: { kind: 'not_found' } };
            return {
              ok: true,
              file: {
                filename: found.filename,
                mimeType: 'application/vnd.ms-excel',
                bytes: new Uint8Array(o.bytes ?? WORKBOOK),
                provenance: {
                  source: 'email',
                  providerMessageId: 'pm-1',
                  providerThreadId: 't-pm-1',
                  attachmentRef: found.ref,
                  // Recorded by the bridge for the audit trail. Evidence must
                  // not carry it, which is what test 3c proves.
                  providerAttachmentId: PROVIDER_ATTACHMENT_ID,
                  messageEvidenceId: 'me-1',
                  attachmentEvidenceId: 'ae-1',
                },
              },
            };
          }
          if (op === 'readMessage') return { ok: true, message: message() };
          return { ok: true, messages: [message()] };
        },
      };
    }
  }

  const readinessFor = async (p: { owner: string }): Promise<ReadinessContext> => (
    o.connectedFor.includes(p.owner)
      ? { mail: { state: 'connected', account: `${p.owner}@x.com`, scopes: { read: true, draft: false, send: false }, checkedAt: 'T' } }
      : {}
  );

  return {
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
    capabilities: [MAIL],
    evidence: o.store,
  };
}

/** Turn 1: Alice finds the message, so a later turn has something to point at. */
async function findTheMessage(d: ReturnType<typeof deps>) {
  return runCapabilityTurn({
    prompt: 'find the email from Hetzner about the September invoice',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-1', requestId: 'r1',
  }, d);
}

/* ------------------------------------------------------------------ *
 * 🚨 3a. The continuation reaches the bytes
 * ------------------------------------------------------------------ */

test('🚨 3a. "the spreadsheet attached to that email" reaches the FILE, not the filename', async () => {
  const calls: Call[] = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store });
  await findTheMessage(d);

  const result = await runCapabilityTurn({
    prompt: 'what revenue does the spreadsheet attached to that email show for South?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  // The reference resolved to the MESSAGE, then the listing continued into a fetch.
  assert.deepEqual(calls.map((c) => c.op), ['search', 'listAttachments', 'fetchAttachment']);
  assert.equal(calls[2]!.attachmentId, OUR_REF, 'the fetch named something other than our ref');
  assert.ok(calls.every((c) => c.principal === ALICE.owner), 'a call ran as someone else');

  const files = result.ledger.ofKind('file');
  assert.equal(files.length, 1, 'the attachment produced no file evidence');

  // 🚨 The exact values a spreadsheet application wrote — currency symbol,
  // percentage sign, negative sign and all.
  const file = files[0]!;
  assert.match(file.text, /South\t\$156500\t-3\.25%\t33101/);
  assert.equal(file.complete, true);
  assert.equal(file.locator.filename, 'regions.xlsx');
});

/* ------------------------------------------------------------------ *
 * 🚨 3b. The digest is the identity
 * ------------------------------------------------------------------ */

test('🚨 3b. the file is identified by the digest of the bytes that were read', async () => {
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls: [], store });
  await findTheMessage(d);

  const result = await runCapabilityTurn({
    prompt: 'summarize the spreadsheet attached to that email',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  const file = result.ledger.ofKind('file')[0]!;
  assert.equal(file.locator.sha256, createHash('sha256').update(WORKBOOK).digest('hex'));
});

/* ------------------------------------------------------------------ *
 * 🚨 3c. No provider attachment id is persisted, anywhere
 * ------------------------------------------------------------------ */

test('🚨 3c. the provider attachment id reaches NOTHING that is stored', async () => {
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls: [], store });
  await findTheMessage(d);
  await runCapabilityTurn({
    prompt: 'summarize the spreadsheet attached to that email',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  const persisted = await store.recent('c1', { principalId: ALICE.owner, workspaceId: ALICE.workspace }, 10);
  const serialized = JSON.stringify(persisted);

  /*
   * 🚨 THE WHOLE PERSISTED RECORD, not one field of it. Gmail regenerates this
   * token on every `messages.get`, so a stored copy is a handle that names
   * nothing an hour later — and one that has to be believed rather than
   * checked, which is how a pointer quietly becomes a permission.
   */
  assert.equal(serialized.includes(PROVIDER_ATTACHMENT_ID), false,
    'a provider attachment id was persisted');
  // Ours, on the other hand, is exactly what a later turn re-resolves with.
  assert.ok(serialized.includes(OUR_REF), 'our stable ref was not persisted');
});

/* ------------------------------------------------------------------ *
 * 🚨 3d. A disconnect between turns fails the continuation closed
 * ------------------------------------------------------------------ */

test('🚨 3d. a disconnect between turns makes the attachment FAIL, not replay', async () => {
  const calls: Call[] = [];
  const store = new MemoryConversationEvidence();

  // Turn 1 and 2: connected. Alice sees the message and lists its attachment.
  const connected = deps({ connectedFor: [ALICE.owner], calls, store });
  await findTheMessage(connected);
  const listing = await runCapabilityTurn({
    prompt: 'what is attached to that email?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, connected);
  assert.equal(listing.ledger.isEmpty(), false, 'the listing produced nothing to point at');

  // Alice disconnects her mailbox. Same conversation, same evidence, same ref.
  const disconnected = deps({ connectedFor: [], calls, store });
  const after = await runCapabilityTurn({
    prompt: 'what does the spreadsheet say?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-3', requestId: 'r3',
  }, disconnected);

  /*
   * 🚨 THE POINTER IS NOT A PERMISSION. The ref is still stored and still
   * valid; the CONNECTION is gone. Serving the stored text back would be the
   * revoked mailbox continuing to answer.
   */
  assert.equal(after.ledger.ofKind('file').length, 0, 'a disconnected mailbox produced file evidence');
  assert.ok(after.executed.some((e) => !e.ok), 'the refusal was not reported');
});

/* ------------------------------------------------------------------ *
 * 🚨 3e. Two candidates: the turn asks rather than picks
 * ------------------------------------------------------------------ */

test('🚨 3e. a singular reference over TWO attachments picks neither', async () => {
  const calls: Call[] = [];
  const store = new MemoryConversationEvidence();
  const d = deps({
    connectedFor: [ALICE.owner], calls, store,
    attachments: [
      { ref: 'ref-one', filename: 'Q3-budget.xlsx' },
      { ref: 'ref-two', filename: 'Q3-budget-final.xlsx' },
    ],
  });
  await findTheMessage(d);

  const result = await runCapabilityTurn({
    prompt: 'what is the total in the spreadsheet attached to that email?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  /*
   * Choosing between these from the wording of a prompt is prose routing, and
   * the cost of getting it wrong is a confident answer quoting the wrong
   * document. So no fetch happens and the candidates go back to the caller.
   */
  assert.equal(calls.filter((c) => c.op === 'fetchAttachment').length, 0, 'the turn guessed');
  assert.deepEqual(result.ambiguousAttachment?.candidates, ['Q3-budget.xlsx', 'Q3-budget-final.xlsx']);
  assert.equal(result.ledger.ofKind('file').length, 0);
});

/* ------------------------------------------------------------------ *
 * 🚨 3f. An unreadable file produces NO evidence
 * ------------------------------------------------------------------ */

test('🚨 3f. a file that cannot be read grounds NOTHING — not even its own name', async () => {
  const store = new MemoryConversationEvidence();
  const d = deps({
    connectedFor: [ALICE.owner], calls: [], store,
    attachments: [{ ref: OUR_REF, filename: 'Q3-budget-2026.xlsx' }],
    bytes: Buffer.from('this is not a workbook'),
  });
  await findTheMessage(d);

  const result = await runCapabilityTurn({
    prompt: 'what is in the spreadsheet attached to that email?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  /*
   * 🚨 A FILENAME IS NOT A FALLBACK. `Q3-budget-2026.xlsx` contains the words
   * "budget" and "2026", so an item whose text is the name would let "the 2026
   * budget was attached" ground itself in a document nobody could open.
   */
  assert.equal(result.ledger.ofKind('file').length, 0, 'an unreadable file produced evidence');
});

/* ------------------------------------------------------------------ *
 * 🚨 3g. Through the SHARED verifier
 * ------------------------------------------------------------------ */

test('🚨 3g. exact spreadsheet values survive the verifier; invented ones do not', async () => {
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls: [], store });
  await findTheMessage(d);
  const turn = await runCapabilityTurn({
    prompt: 'what does the spreadsheet attached to that email show?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  /*
   * 🚨 WRITTEN THE WAY A GROUNDED ANSWER IS. The shared rule is that EVERY
   * significant term of a claim appears in its source — the same bar a cited
   * repository span has to clear. A verb the document never uses fails it, for
   * a file exactly as for a message, which is the point of one standard.
   */
  const answer = [
    'South revenue is $156500 and the margin is -3.25%.',
    'North revenue is $250000.',
  ].join(' ');

  // 🚨 The SAME verifier the repository path uses. No email-shaped exemption,
  // no file-shaped one either.
  const verified = verifyAnswer(answer, { repo: new EvidenceLedger(), other: turn.ledger });

  assert.equal(verified.refused, false, `everything was removed: ${verified.answer}`);
  assert.ok(verified.answer.includes('156500'), 'a value the sheet actually contains was removed');
  assert.equal(verified.answer.includes('250000'), false, 'a value found nowhere in the sheet survived');

  const cited = verified.claims.flatMap((c) => c.otherSources ?? []);
  assert.ok(cited.some((c) => c.kind === 'file'), 'the file was not cited as the source');
  // The handle a reader follows back to these exact bytes.
  const file = turn.ledger.ofKind('file')[0] as FileEvidence;
  assert.ok(cited.some((c) => c.locator === file.locator.sha256));
});

/* ------------------------------------------------------------------ *
 * 🚨 3h. An unproven listing does not continue
 * ------------------------------------------------------------------ */

test('🚨 3h. a listing that does not claim to be COMPLETE triggers no fetch', async () => {
  const calls: Call[] = [];
  const store = new MemoryConversationEvidence();
  const d = deps({ connectedFor: [ALICE.owner], calls, store, withholdKnown: true });
  await findTheMessage(d);

  await runCapabilityTurn({
    prompt: 'what is in the spreadsheet attached to that email?',
    identity: executionIdentityFrom(ALICE),
    conversationId: 'c1', turnId: 'turn-2', requestId: 'r2',
  }, d);

  /*
   * 🚨 THE SAME EMPTY ARRAY MEANS TWO OPPOSITE THINGS. A listing reads the full
   * MIME tree, so its answer is a PROVEN account of what the message carries; a
   * search result's attachments field means nothing was ever inspected.
   * `attachmentsKnown` is the only thing that separates them, and continuing
   * without it is a fetch against a message nobody opened.
   */
  assert.equal(calls.filter((c) => c.op === 'fetchAttachment').length, 0,
    'a fetch followed a listing that never claimed to have looked');
});
