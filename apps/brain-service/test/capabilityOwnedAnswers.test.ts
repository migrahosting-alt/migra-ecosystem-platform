/**
 * THE CAPABILITY OWNS THE FACTS IT ALREADY KNOWS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PRINCIPLE THESE TESTS EXIST TO HOLD
 *
 * A language model should reason where reasoning is needed. It must never be
 * asked to regenerate a fact the system already knows exactly.
 *
 * Owner acceptance proved why. The capability knew, deterministically, that a
 * message carried two attachments and what they were called — and handing those
 * facts to an 8B model to write a sentence about produced, across runs: an
 * invented filename (`migra_test_files_10292020.pdf`), a list whose first entry
 * was missing so the answer began at "2.", and a flat refusal. Retrieval was
 * correct every single time.
 *
 * So a fact held as typed data reaches the user as typed data rendered by code.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';

import { registerAiRoutes } from '../src/engine/chat/aiRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/models/modelRegistry.js';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { bindChatCapabilities } from '../src/engine/chat/chatCapabilities.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';
import { renderAttachmentList } from '../src/engine/chat/answerOwnership.js';

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const HEADERS = { 'x-owner-scope': ALICE.owner, 'x-workspace-scope': ALICE.workspace };

const ATTACHMENTS = [
  { ref: 'ref-pdf', filename: 'migrapilot_email_fixture.pdf', mimeType: 'application/pdf', sizeBytes: 27194 },
  { ref: 'ref-xlsx', filename: 'migrapilot_email_fixture (1).xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 5193 },
];

const message = () => ({
  providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
  from: { address: 'migrateck@gmail.com' }, to: [], cc: [],
  subject: 'test file', sentAt: '2026-09-09T21:00:16.000Z',
  snippet: 'here s the test files', textBody: 'here s the test files',
  bodyComplete: true, attachmentsKnown: true, attachments: [],
  labels: ['INBOX'], unread: false, retrievedAt: '2026-09-10T00:00:00Z',
});

/** Counts every generation call, so "no second model call" is measurable. */
let modelCalls = 0;
/** Whatever the model would say if it were asked. Deliberately WRONG. */
const MODEL_WOULD_SAY = 'The email has one attachment: invented_report_2019.pdf';

function provider() {
  return {
    profile: 'default' as const,
    async isAvailable() { return true; },
    async complete() {
      modelCalls += 1;
      return {
        content: MODEL_WOULD_SAY,
        modelId: 'stub-1', providerId: 'local',
        telemetry: { inputTokens: 1, outputTokens: 1, latencyMs: 1 },
      };
    },
    async *stream() {
      modelCalls += 1;
      for (const part of MODEL_WOULD_SAY.split(' ')) yield { delta: `${part} ` };
    },
  };
}

function install(opts: { attachments?: typeof ATTACHMENTS; summary?: string } = {}) {
  const listed = opts.attachments ?? ATTACHMENTS;
  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async (input: unknown) => {
          const op = String((input as { op?: string }).op ?? 'search');
          if (op === 'listAttachments') {
            return { ok: true, attachmentsKnown: true, attachments: listed };
          }
          if (op === 'summarize') {
            return {
              ok: true,
              summary: opts.summary ?? 'The message shares test files and gives a phone number.',
              complete: true,
              sources: [{
                evidenceId: 'ev-1', providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
                from: 'migrateck@gmail.com', subject: 'test file',
                sentAt: '2026-09-09T21:00:16.000Z', completeness: 'complete',
                text: 'here s the test files. PHONE: 877-545-5428',
              }],
            };
          }
          if (op === 'fetchAttachment') {
            const ref = String((input as { attachmentId?: string }).attachmentId ?? '');
            const found = listed.find((a) => a.ref === ref);
            if (!found) return { ok: false, failure: { kind: 'not_found' } };
            return {
              ok: true,
              file: {
                // Small enough to be shown exactly, which is the whole point.
                filename: 'fixture.csv',
                mimeType: 'text/csv',
                bytes: new TextEncoder().encode('Fixture Value 1,48273.55\nFixture Value 2,7319.42\nFixture Value 3,91504.08'),
                provenance: {
                  source: 'email', providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
                  attachmentRef: found.ref, providerAttachmentId: 'EPHEMERAL',
                  messageEvidenceId: 'me-1', attachmentEvidenceId: 'ae-1',
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
  const readinessFor = async (): Promise<ReadinessContext> => ({
    mail: { state: 'connected', account: 'qa@x.com', scopes: { read: true, draft: false, send: false }, checkedAt: 'T' },
  });
  bindChatCapabilities({
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
    evidence: new MemoryConversationEvidence(),
  });
}

function appWith(memory: ConversationStore) {
  const app = Fastify({ logger: false });
  registerAiRoutes(
    app, STUB_ENV,
    new ModelRegistry({ sources: [], staticModels: [{ id: 'stub-1', provider: 'local', capabilities: CAPS, tier: 'balanced' } as ModelDescriptor] }),
    memory,
    () => provider() as never,
  );
  return app;
}

/** A first turn that finds the message, then the turn under test. */
async function converse(prompts: string[], opts: { stream?: boolean } = {}) {
  const memory = new ConversationStore();
  const app = appWith(memory);
  const conversationId = 'conv_ownedanswers';
  let content = '';
  let tokenFrames: string[] = [];

  for (const prompt of prompts) {
    const res = await app.inject({
      method: 'POST', url: '/api/ai/chat', headers: HEADERS,
      payload: { prompt, conversationId, ...(opts.stream ? { stream: true } : {}) },
    });
    if (opts.stream) {
      tokenFrames = [...res.body.matchAll(/event: token\ndata: (.+)/g)].map((m) => JSON.parse(m[1]!).text as string);
      content = tokenFrames.join('');
    } else {
      content = (res.json().content as string) ?? '';
    }
  }

  const stored = memory.listConversations({ owner: ALICE.owner, workspace: ALICE.workspace })
    .flatMap((c) => memory.getMessages(c.id, { owner: ALICE.owner, workspace: ALICE.workspace }))
    .filter((m) => m.role === 'assistant').map((m) => m.content);

  await app.close();
  return { content, stored, tokenFrames };
}

const FIND = 'find the email about the test file';
const ASK_ATTACHMENTS = 'What attachments are on it?';

/* ------------------------------------------------------------------ *
 * 🚨 1-2. Names come from metadata, and membership is deterministic
 * ------------------------------------------------------------------ */

test('🚨 1. an attachment name can never originate in model text', async () => {
  install();
  modelCalls = 0;
  const { content } = await converse([FIND, ASK_ATTACHMENTS]);

  // The model was scripted to invent exactly the filename owner acceptance saw.
  assert.equal(content.includes('invented_report_2019.pdf'), false,
    `a model-authored filename reached the user: ${content}`);
  for (const a of ATTACHMENTS) {
    assert.ok(content.includes(a.filename), `metadata filename missing: ${a.filename}\n${content}`);
  }
});

test('🚨 2. attachment-list membership is deterministic across 20 runs', async () => {
  /*
   * 🚨 THE BAR THE OWNER SET, AND THE REASON FOR IT. This same question returned
   * both files, one file, and a refusal across three runs when a model wrote the
   * list. Rendering from typed data makes the answer a function of the data.
   */
  const seen = new Set<string>();
  for (let run = 0; run < 20; run += 1) {
    install();
    const { content } = await converse([FIND, ASK_ATTACHMENTS]);
    const names = ATTACHMENTS.filter((a) => content.includes(a.filename)).map((a) => a.filename);
    seen.add(JSON.stringify(names));
  }

  assert.equal(seen.size, 1, `attachment membership varied across runs: ${[...seen].join(' | ')}`);
  assert.deepEqual(JSON.parse([...seen][0]!), ATTACHMENTS.map((a) => a.filename));
});

test('zero attachments is stated as zero, not left to prose', () => {
  const text = renderAttachmentList({
    kind: 'attachment-list', subject: 's', from: 'f', providerMessageId: 'pm-1', attachments: [],
  });
  assert.match(text, /Attachments \(0\)/);
  assert.match(text, /no attachments/i);
});

/* ------------------------------------------------------------------ *
 * 🚨 7. No second generation call
 * ------------------------------------------------------------------ */

test('🚨 7. a capability-owned answer makes NO model generation call', async () => {
  install();
  modelCalls = 0;
  await converse([FIND, ASK_ATTACHMENTS]);

  /*
   * One call for the opening search turn, which is genuinely model-authored.
   * The attachment turn must add none: its facts are typed and its text was
   * rendered from them, so a model could only change it.
   */
  assert.equal(modelCalls, 1, `the capability-owned turn called the model ${modelCalls - 1} extra time(s)`);
});

/* ------------------------------------------------------------------ *
 * 🚨 8. Provenance survives direct rendering
 * ------------------------------------------------------------------ */

test('🚨 8. a directly-rendered answer keeps its provenance and its disclosure', async () => {
  install();
  const { content, stored } = await converse([FIND, ASK_ATTACHMENTS]);

  // A listing names files without opening them — the one thing it cannot speak to.
  assert.match(content, /listed, not opened/i, `the disclosure was dropped: ${content}`);
  // And what the user saw is what the conversation kept.
  assert.equal(stored.at(-1), content, 'the stored answer differs from the answer shown');
});

/* ------------------------------------------------------------------ *
 * 🚨 9. Streaming does not mutate verified facts
 * ------------------------------------------------------------------ */

test('🚨 9. streaming emits the SAME payload, character for character', async () => {
  install();
  const buffered = await converse([FIND, ASK_ATTACHMENTS]);
  install();
  const streamed = await converse([FIND, ASK_ATTACHMENTS], { stream: true });

  assert.equal(streamed.content, buffered.content,
    'the streamed answer differs from the buffered one');
  assert.ok(streamed.tokenFrames.length >= 1, 'nothing was streamed at all');
  assert.equal(streamed.tokenFrames.join(''), streamed.content,
    'the concatenated frames do not reconstruct the payload');
  assert.equal(streamed.content.includes('invented_report_2019.pdf'), false,
    'the streaming path admitted model-authored text');
});

/* ------------------------------------------------------------------ *
 * 🚨 3. A summary is the summariser's, and cannot outrun its sources
 * ------------------------------------------------------------------ */

test('🚨 3. the summariser\'s own prose is the answer, not a model\'s retelling', async () => {
  install({ summary: 'The message shares test files and gives a phone number.' });
  modelCalls = 0;
  const { content } = await converse([FIND, 'Summarize that email']);

  assert.ok(content.includes('shares test files'), `the grounded summary was not used: ${content}`);
  assert.equal(content.includes('invented_report_2019.pdf'), false, 'model text reached a summary answer');
  assert.equal(modelCalls, 1, 'the summary turn re-generated through the model');
});

/* ------------------------------------------------------------------ *
 * 🚨 A listing that led to a fetch is a STEP, not the answer
 * ------------------------------------------------------------------ */

test('🚨 asking for values INSIDE a file does not get the file list back', async () => {
  /*
   * 🚨 CAUGHT BY MEASURING, NOT BY READING. Eight live runs of "what are the
   * exact values in the spreadsheet attached to it?" returned the ATTACHMENT
   * LIST all eight times: the listing had claimed ownership of the answer on
   * its way to finding the spreadsheet, and never let go.
   *
   * What a file SAYS is not a fact the capability holds as typed data — it is
   * extracted text a model reads and the gate checks. Ownership belongs to the
   * listing only when the listing IS the answer.
   */
  install();
  const { content } = await converse([FIND, 'What are the exact values in the spreadsheet attached to it?']);

  assert.equal(content.startsWith('Attachments ('), false,
    `an attachment list was returned for a question about file contents:\n${content}`);
});

/* ------------------------------------------------------------------ *
 * 🚨 6. Hybrid — the model writes around the payload, never inside it
 * ------------------------------------------------------------------ */

test('🚨 6. a file\'s exact contents survive even when the commentary is refused', async () => {
  /*
   * 🚨 MEASURED, NOT ASSUMED. Across eight live runs asking for a spreadsheet's
   * values, the model never produced a WRONG figure — but one run produced NONE,
   * the gate having removed everything it wrote. That is the same unreliability
   * wearing a safe face.
   *
   * The figures are typed data the extractor produced. They are rendered by
   * code and lead the answer; whatever the model writes follows, and being
   * refused costs the commentary rather than the facts.
   */
  install();
  const { content } = await converse([FIND, 'What are the exact values in the spreadsheet attached to it?']);

  // The scripted model text is deliberately unsupported and will be removed.
  assert.equal(content.includes('invented_report_2019.pdf'), false, 'model text survived the gate');
  // The payload is there regardless.
  assert.match(content, /^From fixture\.csv:/m, `the file payload was not emitted:\n${content}`);
  // 🚨 EVERY figure, exactly, regardless of what the model did.
  for (const v of ['48273.55', '7319.42', '91504.08']) {
    assert.ok(content.includes(v), `the payload lost ${v}:\n${content}`);
  }
});

test('🚨 6b. streaming a hybrid answer leads with the same payload', async () => {
  install();
  const buffered = await converse([FIND, 'What are the exact values in the spreadsheet attached to it?']);
  install();
  const streamed = await converse([FIND, 'What are the exact values in the spreadsheet attached to it?'], { stream: true });

  const head = (text: string) => text.split('\n\n')[0];
  assert.equal(head(streamed.content), head(buffered.content),
    'the streamed payload differs from the buffered one');
  assert.equal(streamed.tokenFrames.join(''), streamed.content,
    'the concatenated frames do not reconstruct the answer');
});
