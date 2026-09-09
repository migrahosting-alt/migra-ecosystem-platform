/**
 * THE FOUR THINGS THAT MUST NOT REGRESS.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT WENT WRONG, AND WHAT THESE HOLD
 *
 * The autonomous tool loop carried no identity, so every connected-account
 * capability was denied inside it — and a denial is what a correct system does
 * when it cannot tell who is asking, so nothing looked broken. The fix hands
 * the loop an identity and NOTHING else: the executor resolves what that
 * principal may currently do, on every call, through the same resolver the
 * HTTP path uses.
 *
 * The failure mode being guarded is not "email is denied". It is the opposite:
 * a runtime shared between principals answering with the wrong mailbox, or an
 * unidentified call quietly falling back to a global lookup.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { resolveFilePolicy, DOCUMENT_EXTENSIONS, MAX_UPLOAD_MB } from '@migrapilot/shared-types/file-policy';
import { AgentRegistry, type AgentDefinition, type AgentDescriptor } from '../src/engine/agents/agentRegistry.js';
import { AgentRunStore } from '../src/engine/agents/agentRunStore.js';
import { AgentService } from '../src/engine/agents/agentRuntime.js';
import { CapabilityRegistry, type ReadinessContext } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';
import { executionIdentityFrom } from '../src/engine/identity/executionIdentity.js';
import { bridgeAttachment } from '../src/engine/email/attachmentBridge.js';
import type { EmailAttachmentEvidence } from '../src/engine/email/evidence.js';

/* ------------------------------------------------------------------ *
 * A runtime whose email capability answers with WHOSE mailbox it saw
 * ------------------------------------------------------------------ */

const ALICE = { owner: 'user:alice', workspace: 'personal:alice' };
const BOB = { owner: 'user:bob', workspace: 'personal:bob' };

/** Each principal's own mailbox. Nothing here is shared between them. */
const MAILBOXES: Record<string, string> = {
  'user:alice': 'alice@example.com',
  'user:bob': 'bob@example.com',
};

function connectedFor(owner: string): ReadinessContext {
  const account = MAILBOXES[owner];
  if (!account) return {};
  return {
    mail: {
      state: 'connected',
      account,
      scopes: { read: true, draft: false, send: false },
      checkedAt: '2026-09-09T00:00:00Z',
    },
  };
}

/**
 * The email capability, reporting the account it was ACTUALLY resolved for.
 *
 * Returning the principal's own address is what makes a bleed visible: if the
 * runtime ever answered Bob with Alice's mailbox, the assertion reads it
 * directly rather than inferring it from a count.
 */
class EmailRegistry extends CapabilityRegistry {
  override runnable(id: string) {
    const base = super.runnable(id);
    if (!base || id !== 'migra.email') return base;
    return {
      ...base,
      handler: async (_input: unknown, ctx?: { principal?: { owner: string; workspace: string } }) => ({
        ok: true,
        seenBy: ctx?.principal?.owner ?? null,
        account: ctx?.principal ? MAILBOXES[ctx.principal.owner] ?? null : null,
      }),
    };
  }
}

const descriptor = (id: string): AgentDescriptor => ({
  id,
  kind: 'agent', version: '1', displayName: id, purpose: 'test', operationClasses: ['read'],
  requiredModelCapabilities: [], requiredToolCapabilities: [], readOnly: true, approvalRequired: false,
  resumable: false, cancellable: true, maxSteps: 4, maxRuntimeMs: 30_000, available: true,
});

/** An agent whose whole job is to read mail — i.e. the autonomous loop. */
const READS_MAIL: AgentDefinition = {
  descriptor: descriptor('_test.reads-mail'),
  runtime: 'local',
  inputSchema: z.object({}),
  async plan(_input, ctx) {
    const seen = await ctx.callTool('migra.email', { op: 'search', limit: 5 });
    return { kind: 'result', result: seen };
  },
};

/**
 * ONE runtime, as production has: a single process-wide service that every
 * principal's turns flow through.
 */
function sharedRuntime() {
  const registry = new EmailRegistry();
  return new AgentService(
    new AgentRegistry([READS_MAIL]),
    new AgentRunStore(),
    {
      registry,
      approvals: new ToolApprovalStore(),
      audit: new ToolAudit(),
      // The deployment's ONE resolver, keyed on the principal.
      readinessFor: async (principal) => connectedFor(principal.owner),
    },
  );
}

async function runAs(service: AgentService, scope: { owner: string; workspace: string } | null, requestId: string) {
  const created = await service.createRun({
    agentId: '_test.reads-mail',
    input: {},
    requestId,
    identity: executionIdentityFrom(scope),
  });
  assert.equal(created.ok, true);
  return created.ok ? created.run : null;
}

/* ------------------------------------------------------------------ *
 * 1. Two principals, one runtime
 * ------------------------------------------------------------------ */

test('🚨 1. the same agent runtime cannot bleed one principal\'s mailbox into another\'s', async () => {
  /*
   * The runtime is a singleton and the mailbox is not. Interleaved rather than
   * sequential, because a cache keyed on "the last principal" passes a strictly
   * sequential test and fails a real one.
   */
  const service = sharedRuntime();

  const first = await runAs(service, ALICE, 'r1');
  const second = await runAs(service, BOB, 'r2');
  const third = await runAs(service, ALICE, 'r3');

  assert.deepEqual(first?.result, { ok: true, seenBy: 'user:alice', account: 'alice@example.com' });
  assert.deepEqual(second?.result, { ok: true, seenBy: 'user:bob', account: 'bob@example.com' });
  // Alice again, AFTER Bob — a runtime holding the most recent principal fails here.
  assert.deepEqual(third?.result, { ok: true, seenBy: 'user:alice', account: 'alice@example.com' });
});

test('🚨 1b. a run\'s identity is frozen, so it cannot be rewritten mid-flight', async () => {
  const identity = executionIdentityFrom(ALICE)!;
  assert.throws(
    () => { (identity as { principalId: string }).principalId = 'user:bob'; },
    'a run could be re-pointed at another principal after it started',
  );
});

/* ------------------------------------------------------------------ *
 * 2. A's turn cannot execute with B's connection
 * ------------------------------------------------------------------ */

test('🚨 2. principal A\'s model turn cannot execute Email with principal B\'s connection', async () => {
  /*
   * The nightmare this whole design exists to prevent: a turn that belongs to
   * one person reading another person's mail. The identity travels; the
   * connection is resolved from it and never from anything the turn carries.
   */
  const service = sharedRuntime();

  const alice = await runAs(service, ALICE, 'r-a');
  const result = alice?.result as { seenBy: string; account: string };

  assert.equal(result.seenBy, 'user:alice');
  assert.notEqual(result.account, 'bob@example.com', 'a turn reached another principal\'s mailbox');

  // And Bob's own turn is the control: the capability DOES work, so the
  // assertion above is about isolation rather than about email being broken.
  const bob = await runAs(service, BOB, 'r-b');
  assert.equal((bob?.result as { account: string }).account, 'bob@example.com');
});

/* ------------------------------------------------------------------ *
 * 3. No principal → fail closed
 * ------------------------------------------------------------------ */

test('🚨 3. removing principal context DENIES, and never falls back to a global lookup', async () => {
  /*
   * The tempting failure is a lookup with no scope: "find the connection" when
   * there is exactly one in the database usually returns the right answer in
   * development and someone else's mailbox in production.
   */
  const service = sharedRuntime();
  const run = await runAs(service, null, 'r-none');

  assert.equal(run?.state, 'FAILED', 'an unidentified run was allowed to read mail');
  assert.equal(run?.error?.code, 'CAPABILITY_DENIED');

  const serialised = JSON.stringify(run);
  for (const leaked of ['alice@example.com', 'bob@example.com']) {
    assert.ok(!serialised.includes(leaked), `an unidentified run was told about ${leaked}`);
  }
});

test('🚨 3b. an identity with an empty part is no identity at all', () => {
  // An empty string is not a narrower principal — it is an unknown one, and
  // unknown must fail closed rather than authorize a blank scope.
  assert.equal(executionIdentityFrom({ owner: '', workspace: 'personal:alice' }), null);
  assert.equal(executionIdentityFrom({ owner: 'user:alice', workspace: '   ' }), null);
  assert.equal(executionIdentityFrom(null), null);
  assert.equal(executionIdentityFrom(undefined), null);
});

/* ------------------------------------------------------------------ *
 * 🚨 4. One policy implementation, two callers
 * ------------------------------------------------------------------ */

const source = (...rel: string[]) => readFileSync(join(process.cwd(), ...rel), 'utf8');

const attachment = (over: Partial<EmailAttachmentEvidence> = {}): EmailAttachmentEvidence => ({
  id: 'att_1',
  ref: 'ref-att-1',
  messageId: 'msg_1',
  providerMessageId: 'pm_1',
  providerThreadId: 'pt_1',
  providerAttachmentId: 'pa_1',
  filename: 'invoice.pdf',
  mimeType: 'application/pdf',
  ...over,
});

test('🚨 4. a policy change moves BOTH ordinary upload and Gmail ingestion', () => {
  /*
   * Proven on the CONFIGURATION, which is the only input a deployment owns.
   * One resolver produces the policy; the Gmail bridge is driven by its output
   * here, and the upload path is asserted to call the same function below.
   */
  const principal = { principalId: 'user:alice', workspaceId: 'personal:alice' };

  const generous = resolveFilePolicy({ config: { maxFileMb: 10 }, principal });
  const strict = resolveFilePolicy({ config: { maxFileMb: 0.001 }, principal });

  assert.notEqual(generous.maxBytes, strict.maxBytes, 'the config did not move the policy at all');

  const bytes = new Uint8Array(5_000);
  const accepted = bridgeAttachment({ evidence: attachment(), bytes, policy: generous });
  const refused = bridgeAttachment({ evidence: attachment(), bytes, policy: strict });

  assert.equal(accepted.ok, true, 'the generous policy should have taken these bytes');
  assert.equal(refused.ok, false, 'the strict policy should have refused the same bytes');
  if (!refused.ok) assert.equal(refused.refusal.kind, 'too_large');
});

test('🚨 4b. there is exactly ONE implementation, and both callers reach it', () => {
  /*
   * The behavioural test above drives one function. This is what makes that
   * meaningful: if either caller grew its own copy of the rules, the two would
   * agree today and drift silently — which is the whole failure being guarded,
   * and it has no runtime symptom until a user is refused in one place and
   * accepted in the other.
   */
  const brain = source('src/engine/email/emailExecution.ts');
  const consumer = source('..', 'migrapilot-consumer', 'src', 'server', 'files', 'storage.ts');
  const shim = source('..', 'migrapilot-consumer', 'src', 'features', 'attachments', 'capability.ts');

  for (const [name, text] of [['the Gmail path', brain], ['the upload path', consumer]] as const) {
    assert.match(text, /resolveFilePolicy\(\{/, `${name} does not call the canonical resolver`);
  }
  assert.match(brain, /from '@migrapilot\/shared-types\/file-policy'/);
  assert.match(shim, /export \* from '@migrapilot\/shared-types\/file-policy'/);

  // The table and the ceiling must not be re-declared on either side.
  for (const [name, text] of [['the Brain', brain], ['the consumer', consumer], ['the shim', shim]] as const) {
    assert.doesNotMatch(text, /ATTACHMENT_TYPES\s*:\s*readonly/, `${name} redeclared the type table`);
    assert.doesNotMatch(text, /export const MAX_UPLOAD_MB\s*=/, `${name} redeclared the ceiling`);
  }

  // And the advertised list is the resolver's list, not a parallel one.
  const policy = resolveFilePolicy({
    config: {},
    principal: { principalId: 'user:alice', workspaceId: 'personal:alice' },
  });
  assert.deepEqual([...policy.allowedExtensions], [...DOCUMENT_EXTENSIONS]);
  assert.equal(policy.maxBytes, MAX_UPLOAD_MB * 1024 * 1024);
});

test('🚨 4c. the Gmail capability never accepts a policy from its caller', () => {
  /*
   * A policy that can be passed in is a policy a prompt can choose. The
   * capability input carries two ids and nothing describing the file.
   */
  const registry = source('src/engine/models/capabilityRegistry.ts');
  const execution = source('src/engine/email/emailExecution.ts');

  assert.doesNotMatch(registry, /policy:/, 'the capability layer handles a policy');
  for (const described of ['filename', 'mimeType', 'sizeBytes', 'maxBytes', 'allowedExtensions']) {
    assert.ok(
      !new RegExp(`${described}:\\s*z\\.`).test(registry),
      `the capability schema lets a caller describe an attachment: ${described}`,
    );
  }
  // The fetch resolves its own policy rather than receiving one.
  assert.match(execution, /const policy = resolveFilePolicy\(\{/);
});
