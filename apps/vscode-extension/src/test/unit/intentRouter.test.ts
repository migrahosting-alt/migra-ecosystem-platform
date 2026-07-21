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
