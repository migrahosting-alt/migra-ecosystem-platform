/**
 * THE AUTONOMOUS MAILBOX PATH — one executor, one identity, no forgery.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS PROTECTS
 *
 * The model's tool loop can now reach `migra.email`. That is exactly the place
 * where a mailbox gets read by code that never asked whose it was, so the
 * guarantees are:
 *
 *   · mailbox tools dispatch to the SAME executeToolCore the HTTP route uses
 *   · the identity comes from the RUN, never from the model's arguments
 *   · an unidentified run is not even OFFERED the tools, and refuses if called
 *   · nothing the model says can substitute a principal, workspace or mailbox
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeTool } from '../src/engine/agents/agenticAnswer.js';
import { executionIdentityFrom, principalScopeOf } from '../src/engine/identity/executionIdentity.js';

const source = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

/* ------------------------------------------------------------------ *
 * 🚨 One executor
 * ------------------------------------------------------------------ */

test('🚨 mailbox tools dispatch through the CANONICAL executor, not a second path', () => {
  const loop = source('src/engine/agents/agenticAnswer.ts');

  // It calls the same function /api/ai/tools calls, with the same capability id.
  assert.match(loop, /executeToolCore\(toolDeps, \{/, 'the loop does not use the canonical executor');
  assert.match(loop, /tool: 'migra\.email'/, 'the loop does not dispatch to the registered capability');

  /*
   * And it holds NOTHING mail-specific. A provider, a store, a token or a
   * connection here would be a second execution path wearing a tool's name.
   */
  const code = loop.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of [
    'mailProviderFor', 'GmailProvider', 'MailConnectionStore', 'connectionStore',
    'accessToken', 'refreshToken', 'sealedAccessToken', 'googleOAuthClient',
  ]) {
    assert.ok(!code.includes(forbidden), `the agentic loop reaches a mailbox directly: ${forbidden}`);
  }
});

test('🚨 the loop never reads a principal out of the model\'s arguments', () => {
  const loop = source('src/engine/agents/agenticAnswer.ts');
  const fn = loop.slice(loop.indexOf('async function executeEmailTool'));
  const body = fn.slice(0, fn.indexOf('\nexport async function executeTool'));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /*
   * `args` is model output. Any of these read from it would let a prompt name
   * the mailbox it wants — the exact attack this boundary exists to stop.
   */
  for (const forged of [
    'args.principal', 'args.owner', 'args.workspace', 'args.principalId', 'args.workspaceId',
    'args.account', 'args.accountId', 'args.providerAccountId', 'args.token', 'args.scope',
  ]) {
    assert.ok(!code.includes(forged), `the model can supply its own identity: ${forged}`);
  }

  // The principal comes from the run's identity, converted once.
  assert.match(body, /principal: principalScopeOf\(identity\)/,
    'the dispatch does not take its principal from the run identity');
});

/* ------------------------------------------------------------------ *
 * 🚨 Fail closed without identity
 * ------------------------------------------------------------------ */

test('🚨 an unidentified run cannot execute a mailbox tool', async () => {
  /*
   * Reached through the loop's own dispatcher with no identity and no deps —
   * the state an anonymous visitor's turn is in.
   */
  const loop = await import('../src/engine/agents/agenticAnswer.js');
  const fn = (loop as unknown as Record<string, unknown>).executeTool;
  assert.equal(typeof fn, 'function');

  // The workspace dispatcher does not know the mail tools at all.
  const outcome = await executeTool('email_search', { query: 'invoice' }, '/tmp');
  assert.equal(outcome.ok, false, 'a mailbox tool ran through the workspace dispatcher');
});

test('🚨 the tools are not even OFFERED without an identity', () => {
  const loop = source('src/engine/agents/agenticAnswer.ts');

  assert.match(loop, /const emailAvailable = Boolean\(opts\.identity && opts\.toolDeps\)/,
    'the offer does not depend on having an identity');
  assert.match(loop, /emailAvailable \? \[\.\.\.TOOLS, \.\.\.EMAIL_TOOLS\] : TOOLS/,
    'mailbox tools are offered unconditionally');

  // And the dispatcher refuses regardless of what was offered.
  assert.match(loop, /if \(!identity \|\| !toolDeps\) \{/,
    'the dispatcher does not fail closed on a missing identity');
});

/* ------------------------------------------------------------------ *
 * 🚨 The route derives identity server-side
 * ------------------------------------------------------------------ */

test('🚨 the answer route derives identity from the REQUEST, never the body', () => {
  const route = source('src/engine/chat/answerRoutes.ts');

  assert.match(route, /executionIdentityFrom\(opts\.principalFor\?\.\(request\) \?\? null\)/,
    'the route does not derive identity from the request');

  /*
   * The validated request body must not carry identity at all — matched on
   * exact FIELD NAMES, because `workspaceRoot` is a filesystem path for the
   * coding tools and has nothing to do with a tenancy workspace. A substring
   * check flags it and teaches the next reader to ignore this test.
   */
  const validated = route.slice(route.indexOf('export interface ValidatedAnswerRequest'));
  const shape = validated.slice(0, validated.indexOf('}'));
  for (const forged of [
    'principal', 'principalId', 'owner', 'ownerScope',
    'workspace', 'workspaceId', 'workspaceScope',
    'account', 'accountId', 'mailbox', 'token',
  ]) {
    assert.doesNotMatch(shape, new RegExp(`^\\s*${forged}\\??:`, 'm'),
      `the request body can carry identity: ${forged}`);
  }
  // The one workspace-shaped field that IS legitimate, named for what it is.
  assert.match(shape, /^\s*workspaceRoot: string;$/m);
});

test('🚨 an execution identity carries ONLY the governed fields', () => {
  const identity = executionIdentityFrom({ owner: 'user:alice', workspace: 'personal:alice' })!;
  assert.deepEqual(Object.keys(identity).sort(), ['principalId', 'workspaceId']);
  assert.deepEqual(principalScopeOf(identity), { owner: 'user:alice', workspace: 'personal:alice' });

  // Frozen: a long-running loop cannot re-point itself mid-run.
  assert.throws(() => { (identity as { principalId: string }).principalId = 'user:bob'; });
});

/* ------------------------------------------------------------------ *
 * 🚨 The consumer cannot forge scope either
 * ------------------------------------------------------------------ */

test('🚨 the consumer gateway builds scope headers from the SESSION, not the request', () => {
  const root = join(process.cwd(), '..', 'migrapilot-consumer');
  const gateway = readFileSync(join(root, 'src/server/brain/gateway.ts'), 'utf8');

  // Headers are constructed from nothing — no inbound header object is in scope.
  assert.match(gateway, /const headers = new Headers\(\)/);
  assert.match(gateway, /isDerivedOwnerScope\(emitted\)/,
    'the gateway does not assert the scope it emits was derived here');
  assert.match(gateway, /Refusing to call the Brain with a non-derived owner scope/);

  // And the capability operation carries no identity of its own.
  const ops = readFileSync(join(root, 'src/server/brain/operations.ts'), 'utf8');
  const run = ops.slice(ops.indexOf("case 'runCapability':"));
  const body = run.slice(0, run.indexOf("case 'disconnectMail':"));
  for (const forged of ['owner', 'workspace', 'principal', 'account', 'mailbox']) {
    assert.ok(!body.includes(forged + ':'), `runCapability can carry ${forged} from the browser`);
  }
});

test('🚨 there is no email-specific consumer operation', () => {
  /*
   * A `searchEmail` or `readMailbox` operation would be a second execution path
   * with its own idea of what is connected. The consumer names a capability and
   * an input, and knows nothing else.
   */
  const ops = readFileSync(
    join(process.cwd(), '..', 'migrapilot-consumer', 'src/server/brain/operations.ts'), 'utf8',
  );
  for (const forbidden of ['searchEmail', 'readEmail', 'readMailbox', 'fetchAttachment', 'summarizeEmail']) {
    assert.ok(!ops.includes(`kind: '${forbidden}'`), `a second email path exists: ${forbidden}`);
  }
  assert.match(ops, /kind: 'runCapability'; tool: string/, 'the generic execution operation is missing');
});

/* ------------------------------------------------------------------ *
 * 🚨 Read-only stays read-only
 * ------------------------------------------------------------------ */

test('🚨 no mailbox tool offers draft or send', () => {
  const loop = source('src/engine/agents/agenticAnswer.ts');
  const tools = loop.slice(loop.indexOf('const EMAIL_TOOLS'), loop.indexOf('const EMAIL_TOOL_NAMES'));

  for (const name of ['email_send', 'email_draft', 'email_reply', 'email_compose', 'email_forward']) {
    assert.ok(!tools.includes(name), `a mutation tool is offered to the model: ${name}`);
  }
  for (const op of ["'send'", "'draft'", "'createDraft'"]) {
    assert.ok(!tools.includes(op), `a mutating op is reachable from the loop: ${op}`);
  }
});
