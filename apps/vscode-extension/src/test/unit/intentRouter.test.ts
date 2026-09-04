import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyIntent, detectEcosystem } from '../../chat/intentRouter.js';
import { runEngineerTurn } from '../../chat/engineerTurn.js';
import { PilotError } from '@migrapilot/pilot-client';
import type { MigraAiClient, EngineerStreamEvent } from '../../services/migraAiClient.js';

// ── owner test 1/5: routing matrix ─────────────────────────────────────────────

test('general engineering requests route to the workspace agent', () => {
  assert.equal(classifyIntent('Build a standalone inventory app in this folder.'), 'workspace-task');
  assert.equal(classifyIntent('create a new REST api endpoint'), 'workspace-task');
  assert.equal(classifyIntent('fix the type error in src/chat/chatEngine.ts'), 'workspace-task');
  assert.equal(classifyIntent('run the tests and debug the failures'), 'workspace-task');
  assert.equal(classifyIntent('Investigate why the ordinary-chat request path has high latency stages'), 'workspace-task');
  // From owner physical test 4: creating a utility/database IS engineering
  // (even though "migration" must not trip the ecosystem markers).
  assert.equal(classifyIntent('Create a migration utility for this SQLite database.'), 'workspace-task');
});

test('conversational questions remain on the lightweight chat path', () => {
  assert.equal(classifyIntent('What is a monad?'), 'conversation');
  assert.equal(classifyIntent('How does the capability router pick a model?'), 'conversation');
  assert.equal(classifyIntent('Explain this function'), 'conversation');
  assert.equal(classifyIntent('hello there'), 'conversation');
  assert.equal(classifyIntent('can you compare React and Vue?'), 'conversation');
});

// Regression: a build DIRECTIVE that is not sentence-initial (after a design
// conversation, the user says "you can now build the system") must reach the
// engineer — not fall through to a chat guide. This was the "instead of building
// the app" defect.
test('non-sentence-initial build directives route to the workspace agent', () => {
  for (const p of [
    'you can now build the system',
    'you can now build the whole system',
    'go ahead and build the app',
    'go ahead and create the files',
    'please implement the health poller',
    "let's scaffold the project",
    'now build it',
    'proceed with building the dashboard',
    'i want you to build the backend',
    'can you build the app',       // polite directive, not a real question
    'could you create the service',
    'ok, build the system now',
  ]) {
    assert.equal(classifyIntent(p), 'workspace-task', `should build: ${p}`);
  }
});

// Regression: a user pasting a QUOTED or bulleted build directive ("build the
// system" with surrounding quotes, or "- build the app") must still route — the
// leading quote/marker was defeating the anchored verb match and dropping it to
// chat, which then just asked "what do you want me to build?".
test('leading quotes / list markers do not block build-directive routing', () => {
  for (const p of [
    '"build the system"',
    '"build the system" → engineer inspects your workspace, proposes real files',
    '- build the app',
    '* scaffold the project',
    '1. create the files',
    '`implement the health poller`',
  ]) {
    assert.equal(classifyIntent(p), 'workspace-task', `should build: ${p}`);
  }
  // A quoted QUESTION is still a question.
  assert.equal(classifyIntent('"what is a monad?"'), 'conversation');
});

// Regression: a build order prefixed with a directive LABEL ("MISSION: Build
// the final Assembler…", "TASK: implement X") dead-ended in chat because the
// label defeated the anchored verb match. It must reach the engineer.
test('labelled build orders (MISSION:/TASK:/GOAL:/TODO:) route to the workspace agent', () => {
  for (const p of [
    'MISSION:\nBuild the final MigraAI Studio Enterprise Assembler exactly as shown in the packaged Windows application.',
    'MISSION: build the app',
    'GOAL: create the dashboard',
    'TODO: fix the login bug',
    'Task: implement the export pipeline',
    'Objective — refactor the export pipeline',
  ]) {
    assert.equal(classifyIntent(p), 'workspace-task', `should build: ${p}`);
  }
  // A labelled QUESTION is still a question.
  assert.equal(classifyIntent('Question: what is a monad?'), 'conversation');
  assert.equal(classifyIntent('Context: the app is slow. how do i profile it?'), 'conversation');
});

// Regression (fabrication root cause): "Slice 0: create the standalone MigraWatch
// repository…" fell to CHAT because the numbered label defeated the verb match.
// Chat cannot build, so the model invented a completion report (fake repo path,
// fake HEAD, fake command output). A numbered label must never hide a build order.
test('numbered section labels (Slice 0:/Step 3 -/Phase 1:) still route to the engineer', () => {
  for (const p of [
    'Slice 0: create the standalone MigraWatch repository with pnpm workspaces and packages core, api, worker',
    'Step 3 - build the auth service',
    'Phase 1: scaffold the dashboard app',
    'Milestone 2 — implement the export pipeline',
    'Sprint 4: refactor the export module',
  ]) {
    assert.equal(classifyIntent(p), 'workspace-task', `should build: ${p}`);
  }
  // A labelled QUESTION is still a question.
  assert.equal(classifyIntent('Slice 0: what is the difference between a monorepo and polyrepo?'), 'conversation');
});

test('the lead-in stripper does not hijack genuine questions or chit-chat', () => {
  assert.equal(classifyIntent('can you explain the build system?'), 'conversation');
  assert.equal(classifyIntent('please tell me how the router works'), 'conversation');
  assert.equal(classifyIntent("let's talk about architecture"), 'conversation');
  assert.equal(classifyIntent('now, what do you think of this design?'), 'conversation');
});

test('slash commands are not workspace tasks (handled earlier by /agent)', () => {
  // parseAgentCommand intercepts before classifyIntent ever runs; even if it
  // reached the classifier, a bare /agent command must not classify as a task.
  assert.equal(classifyIntent('/agent workspace.diagnostics.pilot'), 'conversation');
});

// ── owner test 2: ecosystem detection ──────────────────────────────────────────

test('ecosystem context attaches only for ecosystem-related work', () => {
  assert.equal(detectEcosystem({ rootPath: '/home/x/MigraTeck-Ecosystem/dev' }), true);
  assert.equal(detectEcosystem({ prompt: 'Investigate why MigraPanel invoice reminders are delayed' }), true);
  assert.equal(detectEcosystem({ gitRemoteUrl: 'git@github.com:migrahosting-alt/migrapilot-api.git' }), true);
  assert.equal(detectEcosystem({ rootPath: '/home/x/some-inventory-app' }), false);
  // "migrate" must NOT trip the brand marker.
  assert.equal(detectEcosystem({ prompt: 'migrate the database schema to v2' }), false);
});

// ── engineer turn rendering (machine-authored, model-free) ─────────────────────

function fakeStream(events: EngineerStreamEvent[]): MigraAiClient {
  return {
    engineerStream: async function* () {
      for (const e of events) yield e;
    },
  } as unknown as MigraAiClient;
}

test('engineer run renders steps, proposals (not applied), and the final answer', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'route', data: { model: 'coder-1' } },
      { event: 'step', data: { n: 1, tool: 'file.readRange', summary: '{"path":"a.ts"}' } },
      { event: 'proposal', data: { n: 2, preview: { files: [{ path: 'a.ts', before: 'x', after: 'y' }] } } },
      { event: 'final', data: { markdown: 'Done. See the proposed change above.', steps: 2 } },
    ]),
    { rootPath: '/w', task: 't' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /file\.readRange/);
  assert.match(out, /Proposed change — `a\.ts`.*not applied/);
  assert.match(out, /Done\. See the proposed change above\./);
  assert.doesNotMatch(out, /unfortunately|sorry|i can't/i);
});

test('changeset proposal renders NEW files as additions, not failed edits', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'proposal', data: { n: 1, preview: { proposalHash: 'abcdef0123456789', fileCount: 2, ops: [
        { op: 'create', path: 'src/index.js', kind: 'add', before: null, after: 'const x = 1;\n' },
        { op: 'mkdir', path: 'test', kind: 'mkdir', before: null, after: null },
      ] } } },
      { event: 'final', data: { markdown: 'Proposed a new file and a directory for the app scaffold here.' } },
    ]),
    { rootPath: '/w', task: 'build app' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /Proposed changeset\*\* \(2 file\(s\), not applied/);
  assert.match(out, /`src\/index\.js` — \*\*create\*\*/);
  assert.match(out, /\+ const x = 1;/);
  assert.match(out, /`test` — \*\*mkdir\*\*/);
  assert.doesNotMatch(out, /- const x = 1;/, 'a pure addition shows no deletion lines');
});

test('engineer errors render as machine blocks, never prose', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([{ event: 'error', data: { code: 'STEP_LIMIT', message: 'stopped after 12 steps' } }]),
    { rootPath: '/w', task: 't' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /Engineer run failed/);
  assert.match(out, /Failure: STEP_LIMIT — stopped after 12 steps/);
  assert.doesNotMatch(out, /unfortunately|sorry/i);
});

test('engineer transport failure is an honest machine block with the PilotError code', async () => {
  const md: string[] = [];
  const client = {
    engineerStream: async function* (): AsyncGenerator<EngineerStreamEvent> {
      throw new PilotError('NOT_READY', 'engine starting', { requestId: 'req_e1' });
    },
  } as unknown as MigraAiClient;
  await runEngineerTurn(client, { rootPath: '/w', task: 't' }, { markdown: (t) => md.push(t) });
  const out = md.join('');
  assert.match(out, /Engineer dispatch failed before execution/);
  assert.match(out, /Failure: NOT_READY/);
  assert.match(out, /req_e1/);
});

// ── streamed answers ─────────────────────────────────────────────────────────
// The agent streams its final answer as it is written (a buffered reply left the
// user watching nothing during a long local generation). The `final` event then
// repeats that text, so the renderer must append only the remainder.

test('a streamed answer is rendered once, with only the remainder appended', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'token', data: { text: 'The loop lives in ' } },
      { event: 'token', data: { text: '`engineerRuntime.ts:410`.' } },
      { event: 'final', data: { markdown: 'The loop lives in `engineerRuntime.ts:410`.\n\n---\n_footer_', streamedPrefix: true } },
    ]),
    { rootPath: '/w', task: 'where is the loop?' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.equal(out.match(/engineerRuntime\.ts:410/g)?.length, 1, 'the answer appears exactly once');
  assert.match(out, /_footer_/, 'the machine-authored footer is still appended');
});

test('a corrected answer is separated from the streamed text it replaces', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'token', data: { text: 'I have created index.html.' } },
      { event: 'note', data: { n: 1, kind: 'replan', message: 'revising that answer' } },
      { event: 'token', data: { text: 'Nothing was created yet.' } },
      { event: 'final', data: { markdown: 'Nothing was created yet.', streamedPrefix: true } },
    ]),
    { rootPath: '/w', task: 'build it' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /revising that answer/, 'the user is told why the answer changed');
  assert.equal(out.match(/Nothing was created yet\./g)?.length, 1, 'the corrected answer is not doubled');
});

test('without streaming the final still renders in full (buffered providers)', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([{ event: 'final', data: { markdown: 'A complete buffered answer.' } }]),
    { rootPath: '/w', task: 'q' },
    { markdown: (t) => md.push(t) },
  );
  assert.match(md.join(''), /A complete buffered answer\./);
});

test('a plan note renders as a readable block, not a squeezed one-liner', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'note', data: { n: 1, kind: 'plan', message: 'PLAN (0/2 done):\n  [ ] 1. audit the repo\n  [ ] 2. build the route' } },
      { event: 'final', data: { markdown: 'Audited the repo and proposed the route files.' } },
    ]),
    { rootPath: '/w', task: 'audit then build' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /PLAN \(0\/2 done\)/);
  assert.match(out, /\[ \] 1\. audit the repo/);
  assert.match(out, /```text/, 'multi-line plan is a block');
});

test('routing attribution survives the final frame — done is read, not skipped', async () => {
  // The server always sends `final` BEFORE `done`, and this consumer used to
  // `return` on `final`. So `done` — which carries which model answered, under
  // which policy, and whether a fallback was recommended — was never read on ANY
  // successful run. It also made the client log "engineer stream ended without a
  // done frame" on perfectly healthy turns.
  const md: string[] = [];
  const attributions: unknown[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'final', data: { markdown: 'Proposed index.html.' } },
      { event: 'done', data: { outcome: 'completed', routing: { model: 'coder-14b', policy: 'local-only' } } },
    ]),
    { rootPath: '/w', task: 'build the page' },
    { markdown: (t) => md.push(t), onAttribution: (r: unknown) => attributions.push(r) },
  );
  assert.equal(attributions.length, 1, 'attribution must be delivered exactly once');
  assert.deepEqual(attributions[0], { model: 'coder-14b', policy: 'local-only' });
  assert.match(md.join(''), /Proposed index\.html\./, 'and the answer still renders');
});

test('a failed run still reports which model and policy produced the failure', async () => {
  const md: string[] = [];
  const attributions: unknown[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'error', data: { code: 'PROVIDER_CONNECT_TIMEOUT', message: 'provider did not accept the connection' } },
      { event: 'done', data: { outcome: 'timed_out', routing: { model: 'coder-14b', policy: 'local-only' } } },
    ]),
    { rootPath: '/w', task: 'build the page' },
    { markdown: (t) => md.push(t), onAttribution: (r: unknown) => attributions.push(r) },
  );
  assert.match(md.join(''), /PROVIDER_CONNECT_TIMEOUT/);
  assert.deepEqual(attributions[0], { model: 'coder-14b', policy: 'local-only' },
    'knowing which model failed matters most exactly when it failed');
});

test('only one answer is rendered even if the stream repeats a final frame', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'final', data: { markdown: 'The answer.' } },
      { event: 'final', data: { markdown: 'The answer.' } },
      { event: 'done', data: { outcome: 'completed' } },
    ]),
    { rootPath: '/w', task: 't' },
    { markdown: (t) => md.push(t) },
  );
  assert.equal((md.join('').match(/The answer\./g) ?? []).length, 1, 'no duplicated answer');
});

test('a GPU_BUSY refusal is not dressed up as an evidence problem', async () => {
  // The renderer used to send EVERY non-capability refusal down the
  // "Insufficient approved evidence" branch. A busy graphics card would have sent
  // the operator to re-approve a semantic index that was never involved.
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'refusal', data: { code: 'GPU_BUSY', capacity: 'busy',
        message: 'The AI vision engine is busy with another task on the graphics card, so your request has not started yet. Nothing was lost — send it again in a moment and it will run.' } },
      { event: 'done', data: { ok: false, code: 'GPU_BUSY' } },
    ]),
    { rootPath: '/w', task: 'build this page' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /has not started/i);
  assert.match(out, /Nothing was lost/, "the Brain's own sentence is rendered verbatim");
  // The heading must not assert a competing workload the Brain may not have seen —
  // when ComfyUI is merely unreachable, "busy with another task" is unevidenced.
  assert.doesNotMatch(out.split('\n').find((l) => l.startsWith('**')) ?? '', /busy/i);
  assert.doesNotMatch(out, /approved evidence/i, 'wrong boundary — never say this here');
  assert.match(out, /nothing in your workspace changed/i);
});

test('an unreachable engine reads as unreachable, not as a refused request', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'refusal', data: { code: 'ENGINE_UNAVAILABLE', capacity: 'unavailable',
        message: 'The AI engine is not reachable right now, so your request has not started. Nothing was lost.' } },
      { event: 'done', data: { ok: false, code: 'ENGINE_UNAVAILABLE' } },
    ]),
    { rootPath: '/w', task: 'build this page' },
    { markdown: (t) => md.push(t) },
  );
  assert.match(md.join(''), /engine is not reachable/i);
  assert.doesNotMatch(md.join(''), /approved evidence/i);
});

test('an unknown refusal code says so rather than guessing a cause', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'refusal', data: { code: 'SOME_FUTURE_BOUNDARY', message: 'Refused for a reason this client predates.' } },
      { event: 'done', data: { ok: false } },
    ]),
    { rootPath: '/w', task: 't' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /SOME_FUTURE_BOUNDARY/, 'name the code instead of inventing a cause');
  assert.doesNotMatch(out, /approved evidence/i);
});

test('provenance is one muted line, not a wall above the answer', async () => {
  // OBSERVED: "hi" produced SIX stacked italic lines — source mode, live knowledge,
  // sources accepted, capability, tier, unverified task class — above a one-line
  // greeting. Every line true, none informative for that turn.
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'grounding', data: { sourceMode: 'working-tree', requestedMode: 'auto', forced: false } },
      { event: 'liveKnowledge', data: { headline: 'Live knowledge: Off', sourcesAccepted: 0, citations: [], unavailable: [] } },
      { event: 'capability', data: { disclosure: ['Capability: coder-14b — ungoverned for unclassified', 'Tier: deep-local'] } },
      { event: 'final', data: { markdown: 'Hello! How can I assist you today?' } },
      { event: 'done', data: { outcome: 'completed' } },
    ]),
    { rootPath: '/w', task: 'hi' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');

  // Nothing is dropped — the facts still reach the reader.
  assert.match(out, /no approved evidence matched/);
  assert.match(out, /Live knowledge: Off/);
  assert.match(out, /ungoverned for unclassified/);

  // But as ONE line, and before the answer.
  const provenanceLines = out.split('\n').filter((l) => /Source mode|Live knowledge|Capability:/.test(l));
  assert.equal(provenanceLines.length, 1, `expected one provenance line, got:\n${provenanceLines.join('\n')}`);
  assert.ok(
    out.indexOf('Source mode') < out.indexOf('Hello!'),
    'provenance must still precede the answer',
  );
});

test('a refusal still gets its provenance, flushed before the refusal text', async () => {
  const md: string[] = [];
  await runEngineerTurn(
    fakeStream([
      { event: 'grounding', data: { sourceMode: 'approved-index', indexVersion: 7 } },
      { event: 'refusal', data: { code: 'GPU_BUSY', message: 'The card is busy. Nothing was lost.' } },
      { event: 'done', data: { ok: false, code: 'GPU_BUSY' } },
    ]),
    { rootPath: '/w', task: 'build this' },
    { markdown: (t) => md.push(t) },
  );
  const out = md.join('');
  assert.match(out, /Approved index v7/, 'a refused turn must still say what it was grounded on');
  // Anchored on the refusal's OWN text, not on a heading: this previously keyed on
  // wording in the heading, so changing the heading made indexOf return -1 and the
  // ordering check passed judgement on text that was not there.
  const refusalAt = out.indexOf('The card is busy');
  assert.ok(refusalAt > 0, 'the refusal text must be rendered');
  assert.ok(out.indexOf('Approved index') < refusalAt, 'provenance precedes the refusal');
});
