/**
 * NORMAL CHAT IS GROUNDED — through the SHARED verifier, on BOTH answer paths.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE GAP THIS CLOSES
 *
 * `/api/ai/answer` and the autonomous loop have verified their claims for a
 * long time. `/api/ai/chat` never has — it predates the gate, and nothing
 * noticed while it had no retrieved evidence of its own to be wrong about. The
 * moment a mailbox became reachable from normal chat, the surface a person
 * actually types into was the one surface with no gate on it.
 *
 * 🚨 AND THE ONE THAT MATTERS MOST: STREAMING MUST NOT BE A WAY AROUND IT. Two
 * answer paths and a check wired into one of them is a check with a documented
 * bypass — ask for `stream: true` and it is gone.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registerAiRoutes } from '../src/engine/chat/aiRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/models/modelRegistry.js';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { bindChatCapabilities } from '../src/engine/chat/chatCapabilities.js';
import { MemoryConversationEvidence } from '../src/engine/chat/conversationEvidence.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';
import { chatGroundingFor, stripEvidenceLabels, verifyChatAnswer } from '../src/engine/chat/chatGrounding.js';
import { TypedEvidenceLedger, emailEvidence } from '../src/engine/grounding/typedEvidenceLedger.js';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const HEADERS = { 'x-owner-scope': ALICE.owner, 'x-workspace-scope': ALICE.workspace };

function stubModel(): ModelDescriptor {
  return { id: 'stub-1', provider: 'local', capabilities: CAPS, tier: 'balanced' };
}

/** The message the fake mailbox holds. Its numbers are what claims are checked against. */
const message = (over: Record<string, unknown> = {}) => ({
  providerMessageId: 'pm-1', providerThreadId: 't-pm-1',
  from: { address: 'billing@hetzner.com' }, to: [], cc: [],
  subject: 'Invoice 2026-09', sentAt: '2026-09-01T10:00:00Z',
  snippet: 'Your September invoice…',
  textBody: 'Your September invoice totals 48273.55.',
  bodyComplete: true, attachmentsKnown: true, attachments: [],
  labels: ['INBOX'], unread: false, retrievedAt: '2026-09-09T00:00:00Z',
  ...over,
});

/** Whatever the model is scripted to say this turn. */
let scripted = '';

function provider() {
  return {
    profile: 'default' as const,
    async isAvailable() { return true; },
    async complete() {
      return {
        content: scripted,
        modelId: 'stub-1', providerId: 'local',
        telemetry: { inputTokens: 1, outputTokens: 1, latencyMs: 1 },
      };
    },
    // Deliberately fragment-by-fragment, so a bypass would show up as several
    // token frames rather than one.
    async *stream() {
      for (const part of scripted.split(' ')) yield { delta: `${part} ` };
      yield { usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

function install(opts: { connected: boolean; bodyComplete?: boolean }) {
  class R extends CapabilityRegistry {
    override runnable(id: string) {
      const base = super.runnable(id);
      if (!base || id !== 'migra.email') return base;
      return {
        ...base,
        handler: async () => ({
          ok: true,
          messages: [message({ bodyComplete: opts.bodyComplete ?? true })],
        }),
      };
    }
  }
  const readinessFor = async (): Promise<ReadinessContext> => (opts.connected
    ? { mail: { state: 'connected', account: 'qa@x.com', scopes: { read: true, draft: false, send: false }, checkedAt: 'T' } }
    : {});
  bindChatCapabilities({
    toolDeps: { registry: new R(), approvals: new ToolApprovalStore(), audit: new ToolAudit(), readinessFor },
    evidence: new MemoryConversationEvidence(),
  });
}

function appWith(memory: ConversationStore) {
  const app = Fastify({ logger: false });
  registerAiRoutes(
    app, STUB_ENV,
    new ModelRegistry({ sources: [], staticModels: [stubModel()] }),
    memory,
    () => provider() as never,
  );
  return app;
}

/**
 * The ANSWER, without the gate's own explanation of what it removed.
 *
 * 🚨 ASSERTING ON THE WHOLE STRING IS VACUOUS. The removal notice names the
 * terms that failed — "`MAX_PER_MINUTE` — never appeared in anything this run
 * retrieved" — so `content.includes('MAX_PER_MINUTE')` is TRUE for a claim the
 * gate deleted. A mutation that withheld repository evidence entirely survived
 * against exactly that assertion.
 */
function body(content: string): string {
  return content.split('> ⚠️ Grounding gate:')[0]!.trim();
}

/** Ask, and get back the answer plus what the conversation kept. */
async function ask(prompt: string, opts: { stream?: boolean; conversationId?: string } = {}) {
  const memory = new ConversationStore();
  const app = appWith(memory);
  const conversationId = opts.conversationId ?? 'conv_gate01';
  const res = await app.inject({
    method: 'POST', url: '/api/ai/chat', headers: HEADERS,
    payload: { prompt, conversationId, ...(opts.stream ? { stream: true } : {}) },
  });

  let content: string;
  let tokenFrames: string[] = [];
  if (opts.stream) {
    tokenFrames = [...res.body.matchAll(/event: token\ndata: (.+)/g)]
      .map((m) => JSON.parse(m[1]!).text as string);
    content = tokenFrames.join('');
  } else {
    content = res.json().content as string;
  }

  // What the NEXT turn would read back as context.
  const convs = memory.listConversations({ owner: ALICE.owner, workspace: ALICE.workspace });
  const stored = convs.flatMap((c) => memory.getMessages(c.id, { owner: ALICE.owner, workspace: ALICE.workspace }))
    .filter((m) => m.role === 'assistant')
    .map((m) => m.content);

  await app.close();
  return { content, stored, tokenFrames, status: res.statusCode };
}

/* ------------------------------------------------------------------ *
 * 🚨 1-2. Supported survives, unsupported does not
 * ------------------------------------------------------------------ */

test('🚨 1. a SUPPORTED email claim survives normal chat', async () => {
  install({ connected: true });
  scripted = 'The September invoice from billing@hetzner.com totals 48273.55.';

  const { content } = await ask('search my inbox for the September invoice');

  assert.ok(body(content).includes('48273.55'), `the supported claim was removed: ${content}`);
});

test('🚨 2. an UNSUPPORTED email claim is removed', async () => {
  install({ connected: true });
  scripted = [
    'The September invoice from billing@hetzner.com totals 48273.55.',
    'Hetzner also cancelled the contract in October.',
  ].join(' ');

  const { content } = await ask('search my inbox for the September invoice');

  assert.ok(body(content).includes('48273.55'), 'the supported claim was removed with the unsupported one');
  assert.equal(body(content).includes('cancelled the contract'), false,
    'a claim the mailbox never said survived into normal chat');
});

/* ------------------------------------------------------------------ *
 * 🚨 3. Mixed repo + email, one verifier
 * ------------------------------------------------------------------ */

test('🚨 3. repo and email claims in one answer are judged by the SHARED verifier', () => {
  /*
   * At the seam rather than through the route, because standing up an approved
   * semantic index would test the index, not the gate. What is asserted is the
   * thing that matters: repository chunks the chat route retrieved are handed
   * to the SAME verifier, so a repo sentence in a mixed answer is judged on its
   * own evidence instead of being deleted for having none.
   */
  const other = new TypedEvidenceLedger({ principalId: ALICE.owner, workspaceId: ALICE.workspace });
  other.add(emailEvidence({
    id: 'email_1', scope: { principalId: ALICE.owner, workspaceId: ALICE.workspace },
    providerMessageId: 'pm-1', providerThreadId: 't-1',
    subject: 'Invoice 2026-09', from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
    text: 'Your September invoice totals 48273.55.', complete: true,
  }));

  const sources = chatGroundingFor({
    capability: { turn: { ledger: other } as never, unavailable: [] },
    ragChunks: [{
      path: 'src/rateLimiter.ts', startLine: 1, endLine: 3,
      snippet: 'export function throttle(requests: number): boolean {\n  return requests <= MAX_PER_MINUTE;\n}',
    }],
  });
  assert.ok(sources, 'the gate did not engage on a turn with capability evidence');

  const answer = [
    'The throttle function in src/rateLimiter.ts:1-3 returns requests <= MAX_PER_MINUTE.',
    'The September invoice totals 48273.55.',
    'The rate limiter also enforces a nightly quota of 500.',
  ].join(' ');
  const verified = verifyChatAnswer(answer, sources!);

  const answered = body(verified.text);
  assert.ok(answered.includes('MAX_PER_MINUTE'), `the repository claim was removed: ${verified.text}`);
  assert.ok(answered.includes('48273.55'), 'the email claim was removed');
  assert.equal(answered.includes('nightly quota'), false, 'an unsupported claim survived');
});

/* ------------------------------------------------------------------ *
 * 🚨 4. Internal evidence labels are metadata, not text
 * ------------------------------------------------------------------ */

test('🚨 4. an internal evidence id NEVER reaches the user or the conversation', async () => {
  install({ connected: true });
  scripted = 'I retrieved [email_1] and the September invoice from billing@hetzner.com totals 48273.55.';

  const { content, stored } = await ask('search my inbox for the September invoice');

  assert.equal(content.includes('email_1'), false, `an evidence id reached the user: ${content}`);
  assert.equal(stored.join(' ').includes('email_1'), false, 'an evidence id was persisted');
});

test('🚨 4b. an id the run never issued is stripped too', () => {
  /*
   * The leak to guard against is a model INVENTING a label. Stripping only the
   * ids this run happened to mint would let `[email_7]` through, and it looks
   * exactly as authoritative as a real one.
   */
  const empty = new TypedEvidenceLedger({ principalId: 'p', workspaceId: 'w' });
  const out = stripEvidenceLabels('See [email_7] and (file_3) and repo_9 for details.', empty);

  assert.equal(/email_7|file_3|repo_9/.test(out), false, out);
  assert.match(out, /^See and and for details\.$/);
});

test('🚨 4c. stripping does NOT translate a label into a citation', () => {
  /*
   * Turning [email_1] into "the message from billing@hetzner.com" reads better
   * and is worse: the model may have invented the label, and translating would
   * MANUFACTURE a citation to evidence that was never involved.
   */
  const ledger = new TypedEvidenceLedger({ principalId: 'p', workspaceId: 'w' });
  ledger.add(emailEvidence({
    id: 'email_1', scope: { principalId: 'p', workspaceId: 'w' },
    providerMessageId: 'pm-1', providerThreadId: 't-1',
    subject: 'Invoice', from: 'billing@hetzner.com', sentAt: 'T', text: 'x', complete: true,
  }));

  const out = stripEvidenceLabels('Per [email_1], it arrived.', ledger);
  assert.equal(out.includes('billing@hetzner.com'), false, 'a citation was manufactured from a label');
});

/* ------------------------------------------------------------------ *
 * 🚨 5. Preview-only evidence discloses its own partiality
 * ------------------------------------------------------------------ */

test('🚨 5. a preview-only source forces the partiality disclosure', async () => {
  install({ connected: true, bodyComplete: false });
  /*
   * 🚨 A HEADER CLAIM, BECAUSE THAT IS ALL A PREVIEW CAN CARRY. A search
   * returns snippets, so "totals 48273.55" is not merely under-disclosed by a
   * preview — it is unsupported, and the gate removes it outright (asserted
   * below). What a preview DOES support is who sent what and when, and an
   * answer resting on one still has to say it worked from previews.
   */
  scripted = 'There is a September invoice from billing@hetzner.com.';

  const { content } = await ask('search my inbox for the September invoice');

  assert.ok(body(content).includes('billing@hetzner.com'), `the header claim was removed: ${content}`);
  // The completeness flag lives at the evidence layer precisely because by the
  // time there is prose the distinction is unrecoverable.
  assert.match(content, /previews/i, `no partiality disclosure: ${content}`);
});

test('🚨 5b. a preview does NOT support a claim about the body', async () => {
  install({ connected: true, bodyComplete: false });
  scripted = 'The September invoice totals 48273.55.';

  const { content } = await ask('search my inbox for the September invoice');

  // The number is in the full message and not in the snippet. Disclosing
  // partiality is not a licence to state what was never retrieved.
  assert.equal(body(content).includes('48273.55'), false,
    'a body claim survived on preview-only evidence');
});

/* ------------------------------------------------------------------ *
 * 🚨 6. What is kept is what was verified
 * ------------------------------------------------------------------ */

test('🚨 6. the conversation stores the VERIFIED answer, never the raw one', async () => {
  install({ connected: true });
  scripted = [
    'The September invoice from billing@hetzner.com totals 48273.55.',
    'Hetzner also cancelled the contract in October.',
  ].join(' ');

  const { content, stored } = await ask('search my inbox for the September invoice');

  assert.ok(stored.length > 0, 'nothing was persisted at all');
  /*
   * 🚨 THE TWO MUST NOT DIVERGE. Persisting the raw answer and returning the
   * checked one puts an unverified claim into the conversation, where the next
   * turn reads it back as context and the gate never sees it again.
   */
  assert.equal(stored.join(' ').includes('cancelled the contract'), false,
    'an unverified claim was written into the conversation');
  assert.equal(stored[0], content, 'the stored answer differs from the answer shown');
});

/* ------------------------------------------------------------------ *
 * 🚨 7. A broken gate refuses; it does not wave the answer through
 * ------------------------------------------------------------------ */

test('🚨 7. a verifier that THROWS fails closed', () => {
  /*
   * An unknown evidence kind makes `adapterFor` throw by design — a new kind
   * must never be verified by rules written for a different one. That makes it
   * the honest way to break the gate from outside.
   */
  const poisoned = new TypedEvidenceLedger({ principalId: 'p', workspaceId: 'w' });
  poisoned.add({
    kind: 'drive', id: 'drive_1', scope: { principalId: 'p', workspaceId: 'w' },
    text: 'the invoice totals 48273.55', complete: true, locator: {},
  } as never);

  const verified = verifyChatAnswer('The invoice totals 48273.55.', {
    repo: new EvidenceLedger(), other: poisoned,
  });

  assert.equal(verified.refused, true);
  assert.ok(verified.error, 'the failure was not recorded');
  assert.equal(verified.text.includes('48273.55'), false,
    'raw model text was returned when the gate itself failed');
});

/* ------------------------------------------------------------------ *
 * 🚨 8. Repository-only chat is untouched
 * ------------------------------------------------------------------ */

test('🚨 8. a repo-only chat turn keeps its existing behaviour exactly', async () => {
  install({ connected: true });
  // No mailbox noun, so no capability evidence, so no gate — and the answer is
  // returned verbatim, as this route has always done.
  scripted = 'The rate limiter enforces a nightly quota of 500 requests.';

  const { content } = await ask('where is the rate limiter implemented in this repo?');

  assert.equal(content, scripted, 'the gate engaged on a turn with no capability evidence');
});

test('a turn where the capability retrieved NOTHING is also untouched', async () => {
  install({ connected: false });
  scripted = 'I could not reach your mailbox.';

  const { content } = await ask('search my inbox for the September invoice');

  assert.equal(content, scripted, 'the gate engaged with an empty ledger');
});

/* ------------------------------------------------------------------ *
 * 🚨 9. Streaming cannot bypass the gate
 * ------------------------------------------------------------------ */

test('🚨 9. the STREAMING path is verified, and emits nothing before it is', async () => {
  install({ connected: true });
  scripted = [
    'The September invoice from billing@hetzner.com totals 48273.55.',
    'Hetzner also cancelled the contract in October.',
  ].join(' ');

  const { content, tokenFrames, stored } = await ask('search my inbox for the September invoice', { stream: true });

  /*
   * 🚨 ONE FRAME. The stub yields a fragment per word, so an unbuffered stream
   * would produce a dozen — and every one of them would be unverified text
   * already on the user's screen, which cannot be un-said.
   */
  assert.equal(tokenFrames.length, 1, `unverified fragments were streamed: ${tokenFrames.length} frames`);
  assert.equal(body(content).includes('cancelled the contract'), false,
    'the streaming path returned an unsupported claim');
  assert.ok(body(content).includes('48273.55'), 'the streaming path removed a supported claim');
  assert.equal(stored.join(' ').includes('cancelled the contract'), false,
    'the streaming path persisted an unverified claim');
});

test('🚨 9b. a repo-only STREAM still streams token by token', async () => {
  install({ connected: true });
  scripted = 'one two three four';

  const { tokenFrames } = await ask('where is the rate limiter in this repo?', { stream: true });

  // Buffering is the cost of being checked; a turn with nothing to check must
  // not pay it, or the gate would have silently changed every turn's feel.
  assert.ok(tokenFrames.length > 1, `repo-only streaming was buffered: ${tokenFrames.length} frames`);
});

/* ------------------------------------------------------------------ *
 * 🚨 10. There is only one verifier
 * ------------------------------------------------------------------ */

test('🚨 10. aiRoutes contains NO verification logic of its own', () => {
  /*
   * A chat-shaped copy of the verifier is the two-standards problem arriving by
   * the back door — "repo claims are checked, chat claims are checked slightly
   * differently" — and the second standard is always the weaker one. The route
   * may reach the gate only through the one seam.
   */
  // Found by walking up: this runs from `dist/` after a build and from `src/`
  // under tsx, which are different depths.
  const locate = (relative: string): string => {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let up = 0; up < 8; up += 1) {
      const candidate = join(dir, relative);
      if (existsSync(candidate)) return candidate;
      dir = dirname(dir);
    }
    throw new Error(`not found: ${relative}`);
  };
  const source = readFileSync(locate('apps/brain-service/src/engine/chat/aiRoutes.ts'), 'utf8');

  assert.equal(source.includes("from '../grounding/claimVerifier.js'"), false,
    'aiRoutes imports the verifier directly instead of going through chatGrounding');
  assert.equal(/\bverifyAnswer\s*\(/.test(source), false, 'aiRoutes calls the verifier itself');
  assert.ok(source.includes("from './chatGrounding.js'"), 'the route does not use the grounding seam');

  // And the seam calls the shared verifier rather than reimplementing it.
  const seam = readFileSync(locate('apps/brain-service/src/engine/chat/chatGrounding.ts'), 'utf8');
  assert.ok(seam.includes("from '../grounding/claimVerifier.js'"), 'the seam does not use the shared verifier');
});
