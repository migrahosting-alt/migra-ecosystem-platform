/**
 * SUMMARY AS ORCHESTRATION — over canonical evidence, never over a provider.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE SHAPE BEING PROTECTED
 *
 * principal → connection → read through the canonical provider → evidence →
 * completeness → prose → provenance.
 *
 * The provider is never told a summary is happening, and the summariser is
 * handed finished text with nothing to fetch with. The dangerous version of
 * this feature reads a mailbox of its own, or writes fluent prose about a read
 * that failed — both produce an answer that looks exactly like a good one.
 */

import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  bindEmailExecution,
  executeEmailSummarize,
} from '../src/engine/email/emailExecution.js';
import { __resetInFlightForTest } from '../src/engine/email/tokenRefresh.js';
import type { MailConnectionRecord, MailConnectionStore } from '../src/engine/email/connectionStore.js';
import { MAIL_TOKEN_KEY_ENV, seal, sealKeyFrom, type SealKey } from '../src/engine/email/tokenSealing.js';
import { GOOGLE_SCOPES } from '../src/engine/email/oauthConfig.js';
import { SNIPPET_LIMITATION } from '../src/engine/email/evidence.js';
import type { ToolHandlerContext } from '../src/engine/models/capabilityRegistry.js';

const keyResult = sealKeyFrom({ [MAIL_TOKEN_KEY_ENV]: Buffer.alloc(32, 9).toString('base64') });
assert.equal(keyResult.ok, true);
const key = (keyResult as { ok: true; key: SealKey }).key;

const NOW = 2_000_000;
const ALICE = { owner: 'user:alice', workspace: 'ws:1' };
const BOB = { owner: 'user:bob', workspace: 'ws:1' };

function record(scope: typeof ALICE, accountId: string): MailConnectionRecord {
  const b = (purpose: 'access_token' | 'refresh_token') => ({
    ownerScope: scope.owner, workspaceScope: scope.workspace,
    provider: 'gmail', providerAccountId: accountId, purpose,
  } as const);
  return {
    ownerScope: scope.owner,
    workspaceScope: scope.workspace,
    provider: 'gmail',
    providerAccountId: accountId,
    accountAddress: `${accountId}@example.com`,
    sealedAccessToken: seal(key, b('access_token'), `access-${accountId}`),
    sealedRefreshToken: seal(key, b('refresh_token'), `refresh-${accountId}`),
    accessTokenExpiresAt: NOW + 3_600_000,
    grantedScopes: [GOOGLE_SCOPES.read],
    authorizationRevokedAt: null,
    connectedAt: 1_000,
    lastRefreshAt: null,
    updatedAt: 1_000,
  };
}

/** A synthetic Gmail message. `full` decides whether a body comes back. */
function raw(id: string, over: { subject?: string; body?: string | null; thread?: string } = {}) {
  const body = over.body === null ? undefined : (over.body ?? 'The full text of this message.');
  return {
    id,
    threadId: over.thread ?? `t-${id}`,
    labelIds: ['INBOX'],
    snippet: 'A preview only.',
    internalDate: '1757404800000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'billing@example.com' },
        { name: 'Subject', value: over.subject ?? `Subject ${id}` },
      ],
      ...(body ? { body: { data: Buffer.from(body).toString('base64url') } } : {}),
    },
  };
}

/** Whose mailbox the transport is answering for, keyed by bearer token. */
function transportFor(mail: Record<string, unknown>, calls: string[] = []) {
  const fake = async (input: unknown, init: unknown): Promise<unknown> => {
    const url = String(input);
    calls.push(url);
    const headers = ((init ?? {}) as { headers?: Record<string, string> }).headers ?? {};
    const token = (headers.authorization ?? '').replace('Bearer ', '');
    const forToken = mail[token];
    if (!forToken) return { ok: false, status: 401, json: async () => ({}) };

    const box = forToken as { messages: ReturnType<typeof raw>[]; fail?: number };
    if (box.fail) return { ok: false, status: box.fail, json: async () => ({}) };

    if (url.includes('/threads/')) {
      return { ok: true, status: 200, json: async () => ({ id: 'thr-1', messages: box.messages }) };
    }
    if (url.includes('/messages/')) {
      const id = url.split('/messages/')[1]!.split('?')[0]!;
      const found = box.messages.find((m) => m.id === id);
      return found
        ? { ok: true, status: 200, json: async () => found }
        : { ok: false, status: 404, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ messages: box.messages.map((m) => ({ id: m.id })) }),
    };
  };
  return { fetch: fake as unknown as typeof globalThis.fetch, calls };
}

interface BindOpts {
  records: MailConnectionRecord[];
  mail: Record<string, unknown>;
  generate?: (input: { instructions: string; material: string }) => Promise<string>;
  omitGenerator?: boolean;
}

function bind(opts: BindOpts) {
  const wire = transportFor(opts.mail);
  const seen: Array<{ instructions: string; material: string }> = [];
  const store: MailConnectionStore = {
    list: async (scope, provider) =>
      opts.records.filter((r) => r.ownerScope === scope.owner
        && r.workspaceScope === scope.workspace && r.provider === provider),
    get: async (scope, provider, id) =>
      opts.records.find((r) => r.ownerScope === scope.owner
        && r.workspaceScope === scope.workspace && r.provider === provider
        && r.providerAccountId === id) ?? null,
    put: async () => {},
    recordRefresh: async () => {},
    markAuthorizationRevoked: async () => {},
    disconnect: async () => true,
  };
  bindEmailExecution({
    connections: store,
    key,
    // The access token is the record's own, so the transport can tell mailboxes apart.
    refresh: async () => ({ kind: 'refreshed', accessToken: 'fresh', expiresAt: NOW + 3_600_000 }),
    now: () => NOW,
    filePipeline: {},
    transport: wire.fetch,
    providerBaseUrl: 'https://gmail.test/v1/users/me',
    ...(opts.omitGenerator ? {} : {
      generateSummary: async (input) => {
        seen.push(input);
        return opts.generate ? opts.generate(input) : 'Billing sent two messages.';
      },
    }),
  });
  return { seen, calls: wire.calls };
}

const ctxFor = (scope: typeof ALICE): ToolHandlerContext => ({ principal: scope });

afterEach(() => {
  bindEmailExecution(null);
  __resetInFlightForTest();
});

/* ------------------------------------------------------------------ *
 * 1. Evidence cannot come from another principal
 * ------------------------------------------------------------------ */

test('🚨 1. a summary cannot consume evidence from another principal or workspace', async () => {
  /*
   * Alice and Bob both have connections. The transport answers per TOKEN, so a
   * summary built from the wrong connection would visibly contain the wrong
   * subjects rather than merely being "wrong somewhere".
   */
  bind({
    records: [record(ALICE, 'alice-1'), record(BOB, 'bob-1')],
    mail: {
      'access-alice-1': { messages: [raw('a1', { subject: 'ALICE INVOICE' })] },
      'access-bob-1': { messages: [raw('b1', { subject: 'BOB PAYSLIP' })] },
    },
  });

  const alice = await executeEmailSummarize({ keywords: 'anything', ctx: ctxFor(ALICE) });
  assert.equal(alice.ok, true);
  if (alice.ok) {
    assert.deepEqual(alice.sources.map((s) => s.subject), ['ALICE INVOICE']);
    assert.ok(!JSON.stringify(alice).includes('BOB PAYSLIP'), 'another principal\'s mail reached the summary');
  }

  // Same runtime, same binding, different principal — the control.
  const bob = await executeEmailSummarize({ keywords: 'anything', ctx: ctxFor(BOB) });
  assert.equal(bob.ok, true);
  if (bob.ok) assert.deepEqual(bob.sources.map((s) => s.subject), ['BOB PAYSLIP']);
});

test('🚨 1b. the same owner in a DIFFERENT workspace gets nothing', async () => {
  // Workspace is part of the scope, not decoration on it.
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
  });
  const other = await executeEmailSummarize({
    keywords: 'x',
    ctx: { principal: { owner: ALICE.owner, workspace: 'ws:other' } },
  });
  assert.equal(other.ok, false);
  assert.ok(!other.ok && 'failure' in other, 'expected a FAILURE outcome, got: ' + JSON.stringify(other));
  if (!other.ok && 'failure' in other) assert.equal(other.failure.kind, 'not_connected');
});

/* ------------------------------------------------------------------ *
 * 2. Partial evidence → explicitly partial summary
 * ------------------------------------------------------------------ */

test('🚨 2. a snippet-only evidence set produces an explicitly partial summary', async () => {
  /*
   * A search returns previews. The disclosure is ATTACHED, not requested: an
   * instruction to a model fails silently on the answer nobody reads.
   */
  bind({
    records: [record(ALICE, 'alice-1')],
    // No body → metadata only → snippet, exactly as a real search returns.
    mail: { 'access-alice-1': { messages: [raw('a1', { body: null })] } },
    generate: async () => 'Everything is fine and complete.',
  });

  const result = await executeEmailSummarize({ keywords: 'invoice', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.complete, false);
    assert.ok(result.summary.includes(SNIPPET_LIMITATION), 'a partial summary omitted its limitation');
    assert.deepEqual(result.sources.map((s) => s.completeness), ['snippet']);
  }
});

test('a complete evidence set carries no limitation it does not have', async () => {
  // A caveat that is not true teaches people to ignore it when it is.
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
    generate: async () => 'Billing sent one message.',
  });
  const result = await executeEmailSummarize({ messageId: 'a1', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.complete, true);
    assert.ok(!result.summary.includes(SNIPPET_LIMITATION));
  }
});

/* ------------------------------------------------------------------ *
 * 3. A failure cannot become a confident summary
 * ------------------------------------------------------------------ */

test('🚨 3. a provider failure is reported, never summarised', async () => {
  /*
   * The dangerous outcome is fluent prose about a mailbox nobody could open.
   * The generator is deliberately eager — it would happily write something.
   */
  let generatorCalled = false;
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [], fail: 503 } },
    generate: async () => { generatorCalled = true; return 'Everything looks quiet in your inbox.'; },
  });

  const result = await executeEmailSummarize({ keywords: 'invoice', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'failure' in result, 'expected a FAILURE outcome, got: ' + JSON.stringify(result));
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'provider_unavailable');
  assert.equal(generatorCalled, false, 'the summariser ran over a failed read');
});

test('🚨 3b. an EMPTY mailbox is no_results, not a summary of nothing', async () => {
  // "Nobody looked" and "there was nothing to say" are different facts, and
  // prose erases the difference.
  let generatorCalled = false;
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [] } },
    generate: async () => { generatorCalled = true; return 'Your inbox is empty.'; },
  });
  const result = await executeEmailSummarize({ keywords: 'nothing', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'failure' in result, 'expected a FAILURE outcome, got: ' + JSON.stringify(result));
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'no_results');
  assert.equal(generatorCalled, false);
});

test('🚨 3c. a generator that fails is unavailability, not an empty summary', async () => {
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
    generate: async () => { throw new Error('model down'); },
  });
  const result = await executeEmailSummarize({ messageId: 'a1', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'failure' in result, 'expected a FAILURE outcome, got: ' + JSON.stringify(result));
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'provider_unavailable');
});

test('a deployment with no summariser REFUSES rather than inventing one', async () => {
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
    omitGenerator: true,
  });
  const result = await executeEmailSummarize({ messageId: 'a1', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'refusal' in result, 'expected a REFUSAL outcome, got: ' + JSON.stringify(result));
  if (!result.ok && 'refusal' in result) assert.equal(result.refusal.kind, 'no_summariser');
});

/* ------------------------------------------------------------------ *
 * 4. Provenance
 * ------------------------------------------------------------------ */

test('🚨 4. every summary traces to canonical message evidence', async () => {
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: {
      'access-alice-1': {
        messages: [raw('a1', { subject: 'One', thread: 'T' }), raw('a2', { subject: 'Two', thread: 'T' })],
      },
    },
  });

  const result = await executeEmailSummarize({ threadId: 'T', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.sources.length, 2);
  for (const s of result.sources) {
    assert.match(s.evidenceId, /^msg_/, 'a source is not canonical evidence');
    assert.ok(s.providerMessageId, 'a source cannot be traced back to a message');
    assert.ok(s.sentAt && s.subject !== undefined);
  }
  // Thread provenance is the thread that was read, not a mixture.
  assert.deepEqual([...new Set(result.sources.map((s) => s.providerThreadId))], ['T']);
});

test('🚨 4b. the material handed to the model carries no provider ids', async () => {
  /*
   * A summary naming a provider id has left what was retrieved and entered
   * describing the machinery — and those ids are also how a prompt would try to
   * ask for something it was never given.
   */
  const bound = bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
  });
  const result = await executeEmailSummarize({ messageId: 'a1', ctx: ctxFor(ALICE) });
  assert.equal(result.ok, true);

  assert.equal(bound.seen.length, 1);
  const handed = JSON.stringify(bound.seen[0]);
  assert.ok(!handed.includes('access-alice-1'), 'a credential reached the summariser');
  assert.ok(!handed.includes('t-a1'), 'a provider thread id reached the summariser');
  assert.match(handed, /only what appears/i, 'the instructions do not constrain the model');
});

/* ------------------------------------------------------------------ *
 * 6. No identity → fail closed
 * ------------------------------------------------------------------ */

test('🚨 6. removing the execution identity makes summary fail closed', async () => {
  let generatorCalled = false;
  bind({
    records: [record(ALICE, 'alice-1')],
    mail: { 'access-alice-1': { messages: [raw('a1')] } },
    generate: async () => { generatorCalled = true; return 'x'; },
  });

  const result = await executeEmailSummarize({ keywords: 'invoice', ctx: undefined });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && 'failure' in result, 'expected a FAILURE outcome, got: ' + JSON.stringify(result));
  if (!result.ok && 'failure' in result) assert.equal(result.failure.kind, 'refused');
  assert.equal(generatorCalled, false, 'an unidentified request produced a summary');
  assert.ok(!JSON.stringify(result).includes('alice-1@example.com'));
});

/* ------------------------------------------------------------------ *
 * 5 + 7. One implementation, no bypass
 * ------------------------------------------------------------------ */

test('🚨 5. the tools route and the agent loop share ONE summary implementation', async () => {
  /*
   * Both reach capabilities through executeToolCore and the same registry
   * handler, so "same implementation" is a property of there being exactly one
   * call site rather than of two paths agreeing today.
   */
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const registry = readFileSync(join(process.cwd(), 'src/engine/models/capabilityRegistry.ts'), 'utf8');

  const calls = registry.match(/executeEmailSummarize\(/g) ?? [];
  assert.equal(calls.length, 1, 'summarisation is invoked from more than one place');
  assert.match(registry, /case 'summarize':/);
});

test('🚨 7. no deterministic planner can bypass the capability executor', async () => {
  /*
   * routeEmail was a second dispatcher: it turned a sentence into a tool call
   * without an identity, and keeping it would have meant two routing
   * authorities. It was deleted rather than left dormant, because dormant
   * architecture gets wired back up by someone who does not know why it was
   * parked.
   */
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');

  for (const gone of ['src/engine/email/emailRouting.ts', 'src/engine/email/plan.ts']) {
    assert.equal(existsSync(join(process.cwd(), gone)), false, `${gone} came back as a second router`);
  }
});
