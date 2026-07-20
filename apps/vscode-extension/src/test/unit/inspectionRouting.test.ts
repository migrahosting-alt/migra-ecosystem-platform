// Regression: MigraPilot local-tool routing refusal.
//
// Proves read-only workspace inspection routes to the LOCAL runner and returns
// real evidence + truthful typed errors — and NEVER the false "AI can't access
// your local environment" chatbot refusal. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIntent, buildInspectionPlan } from '../../chat/intentRouter.js';
import { runInspectionTurn, renderRoutingError } from '../../chat/inspectionTurn.js';
import { PilotError } from '@migrapilot/pilot-client';
import type { MigraAiClient, InspectRequest, InspectResponse } from '../../services/migraAiClient.js';

const REFUSAL_PHRASES = /cannot (directly )?(interact|access)|can'?t access|do not have access|as an ai|unable to access your (local|computer)/i;

function sink(): { md: string; s: { markdown(t: string): void; progress?(t: string): void } } {
  const box = { md: '' };
  return { get md() { return box.md; }, s: { markdown: (t: string) => { box.md += t; }, progress: () => {} } } as unknown as { md: string; s: { markdown(t: string): void } };
}

function fakeClient(handler: (req: InspectRequest) => InspectResponse | Promise<InspectResponse> | never): MigraAiClient {
  return { inspect: async (req: InspectRequest) => handler(req) } as unknown as MigraAiClient;
}

// ── classification ─────────────────────────────────────────────────────────────

test('the reproduction prompts all classify as inspection (routed to the local runner)', () => {
  for (const p of [
    'report the current workspace root',
    'search the workspace for a directory named engine',
    'run read-only git commands',
    'list files without modifying anything',
    'what is the git status?',
    'show me git status --short',
    'git rev-parse HEAD',
    'git remote -v',
    'which package manager does this repo use?',
  ]) {
    assert.equal(classifyIntent(p), 'inspection', `should inspect: ${p}`);
  }
});

test('conversational + engineering intents are NOT hijacked by the inspection classifier', () => {
  assert.equal(classifyIntent('What is a monad?'), 'conversation');
  assert.equal(classifyIntent('Explain this function'), 'conversation');
  assert.equal(classifyIntent('can you compare React and Vue?'), 'conversation');
  assert.equal(classifyIntent('Build a standalone inventory app in this folder.'), 'workspace-task');
  assert.equal(classifyIntent('fix the type error in src/chat/chatEngine.ts'), 'workspace-task');
});

test('a design/build/proposal prompt is NOT treated as a workspace inspection', () => {
  // Regression: a long design prompt mentioning files/domains was classified as
  // inspection and dead-ended on a read of a domain, instead of being answered.
  const design =
    'Proposed system: MigraWatch Mobile dashboard. It should show a live status feed, ' +
    'read tenant config, and wire up compassionfuneralchapel.com as the first tenant with SSL and DNS.';
  assert.notEqual(classifyIntent(design), 'inspection');
  assert.notEqual(classifyIntent('design a dashboard that displays the repo files'), 'inspection');
  assert.notEqual(classifyIntent('wire it up so the app can read config files'), 'inspection');
  // Genuine short inspection requests STILL route to inspection.
  assert.equal(classifyIntent('what is the git status?'), 'inspection');
  assert.equal(classifyIntent('list the files in src'), 'inspection');
  assert.equal(classifyIntent('show me the workspace root'), 'inspection');
});

test('a bare domain name is NOT planned as a file read', () => {
  // Regression: "compassionfuneralchapel.com" was read as a file → ENOENT.
  const plan = buildInspectionPlan('Proposed system: MigraWatch. Show the compassionfuneralchapel.com dashboard');
  assert.ok(!plan.some((s) => s.op === 'read'), 'a domain must not become a read op');
  // A real file path IS still planned.
  const readReal = buildInspectionPlan('open src/server.ts');
  assert.equal(readReal.find((s) => s.op === 'read')?.path, 'src/server.ts');
  assert.equal(buildInspectionPlan('show package.json').find((s) => s.op === 'read')?.path, 'package.json');
});

test('the inspection plan maps prompts to concrete read-only ops', () => {
  assert.deepEqual(buildInspectionPlan('report the current workspace root').map((s) => s.op), ['workspace_root']);
  assert.ok(buildInspectionPlan('run read-only git commands').some((s) => s.op === 'git_status'));
  assert.ok(buildInspectionPlan('run read-only git commands').some((s) => s.op === 'git_head'));
  assert.ok(buildInspectionPlan('list files without modifying anything').some((s) => s.op === 'list'));
  // "directory named engine" → filesystem NAME search (find, kind=dir), NOT content search.
  const dirSearch = buildInspectionPlan('search the workspace for a directory named engine');
  const findStep = dirSearch.find((s) => s.op === 'find');
  assert.equal(findStep?.query, 'engine');
  assert.equal(findStep?.kind, 'dir');
  assert.ok(!dirSearch.some((s) => s.op === 'search'), 'a directory-name search must not become a content search');
  // "files named X" → find kind=file; explicit content search stays `search`.
  assert.equal(buildInspectionPlan('find files named config.ts').find((s) => s.op === 'find')?.kind, 'file');
  assert.ok(buildInspectionPlan('search for the text TODO inside the code').some((s) => s.op === 'search'), 'explicit content search maps to `search`');
  assert.equal(buildInspectionPlan('which package manager does this repo use?')[0]!.op, 'pkg_manager');
  // list sub-path: real paths are captured; English idioms after "in" are NOT
  // mistaken for a directory (regression: "in accordance" → list[accordance]).
  assert.equal(buildInspectionPlan('list files under src').find((s) => s.op === 'list')?.path, 'src');
  assert.equal(buildInspectionPlan('list files inside apps/api/src').find((s) => s.op === 'list')?.path, 'apps/api/src');
  const idiom = buildInspectionPlan('list the api modules in accordance with the spec').find((s) => s.op === 'list');
  assert.equal(idiom?.path, undefined, 'an "in accordance" idiom must not become a bogus list sub-path');
  assert.equal(buildInspectionPlan('list files in general and check the modules').find((s) => s.op === 'list')?.path, undefined);
  // A generic inspection never yields an empty plan.
  assert.ok(buildInspectionPlan('inspect the workspace').length >= 1);
});

// ── execution: routes to the local runner, returns evidence, never refuses ──────

test('inspection returns REAL local-runner evidence, never a chatbot refusal', async () => {
  const box = sink();
  const client = fakeClient((req) => {
    if (req.op === 'workspace_root') return { ok: true, op: 'workspace_root', runner: 'local', executionScope: 'local', traceId: 't1', data: { root: '/ws/app' } };
    return { ok: true, op: 'git_status', runner: 'local', executionScope: 'local', traceId: 't2', data: { branch: 'main', clean: false, files: [{ status: ' M', path: 'a.ts' }] } };
  });
  await runInspectionTurn(client, '/ws/app', [{ op: 'workspace_root' }, { op: 'git_status' }], box.s);
  assert.match(box.md, /\/ws\/app/);
  assert.match(box.md, /branch `main`/);
  assert.match(box.md, /a\.ts/);
  assert.doesNotMatch(box.md, REFUSAL_PHRASES, 'must never emit a generic "AI cannot access local" refusal');
});

test('a local runner outage returns local_runner_unavailable (typed, with trace)', async () => {
  const box = sink();
  const client = fakeClient(() => { throw new PilotError('NETWORK', 'connect ECONNREFUSED', { requestId: 'rid-9' }); });
  await runInspectionTurn(client, '/ws/app', [{ op: 'git_status' }], box.s);
  assert.match(box.md, /error:\s+local_runner_unavailable/);
  assert.match(box.md, /trace:\s+rid-9/);
  assert.match(box.md, /runner:\s+local/);
  assert.doesNotMatch(box.md, REFUSAL_PHRASES);
});

test('an out-of-scope path surfaces scope_not_authorized (from the runner), not a refusal', async () => {
  const box = sink();
  const client = fakeClient(() => ({ ok: false, op: 'read', runner: 'local', executionScope: 'local', traceId: 't-scope', code: 'scope_not_authorized', error: 'Path escapes the workspace root', remediation: 'Use a path inside the workspace.' }));
  await runInspectionTurn(client, '/ws/app', [{ op: 'read', path: '../../etc/passwd' }], box.s);
  assert.match(box.md, /error:\s+scope_not_authorized/);
  assert.match(box.md, /trace:\s+t-scope/);
  assert.doesNotMatch(box.md, REFUSAL_PHRASES);
});

test('a policy denial surfaces policy_denied (typed), and a tool failure never becomes a generic refusal', async () => {
  const denied = sink();
  await runInspectionTurn(
    fakeClient(() => ({ ok: false, op: 'git_status', runner: 'local', executionScope: 'local', traceId: 'p1', code: 'policy_denied', error: 'inspection disabled by policy' })),
    '/ws/app', [{ op: 'git_status' }], denied.s,
  );
  assert.match(denied.md, /error:\s+policy_denied/);

  const failed = sink();
  await runInspectionTurn(
    fakeClient(() => ({ ok: false, op: 'git_head', runner: 'local', executionScope: 'local', traceId: 'f1', code: 'tool_execution_failed', error: 'not a git repository' })),
    '/ws/app', [{ op: 'git_head' }], failed.s,
  );
  assert.match(failed.md, /error:\s+tool_execution_failed/);
  assert.doesNotMatch(failed.md, REFUSAL_PHRASES);
});

test('workspace_not_open renders a truthful typed block with remediation (never a refusal)', () => {
  const box = sink();
  renderRoutingError(box.s, 'workspace_not_open', { operation: 'workspace inspection', traceId: 'req-1' });
  assert.match(box.md, /error:\s+workspace_not_open/);
  assert.match(box.md, /remediation:.*Open a folder/);
  assert.match(box.md, /runner:\s+local/);
  assert.doesNotMatch(box.md, REFUSAL_PHRASES);
});
