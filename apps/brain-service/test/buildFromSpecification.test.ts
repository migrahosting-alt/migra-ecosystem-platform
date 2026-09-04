// Build-from-specification — the turn is handed its requirement and must produce it.
//
// THE LIVE FAILURE THIS PINS. "use the mockup draft and build this page exactly as
// it is.", with the mockup attached and already read into a design specification.
// The agent ran ONE `workspace.find` for `index.html,styles.css,app.js`, found
// nothing — the page did not exist yet, which is why it had been asked for — and
// finished with "I have not created or proposed any files yet. Please provide more
// details or clarify your request."
//
// TWO defects met there, and both are covered below:
//   1. the guard against handing work back was gated on `toolStepCount === 0`, so a
//      single search switched it off; it is keyed on OUTPUT now.
//   2. the controller's intent was hard-coded 'UNKNOWN', and the specification was
//      concatenated onto the user's message by the client, so nothing downstream
//      could tell a turn that CAME WITH its requirement from one that lacked it.
//
// Case B is the one that must never be "fixed": it is Record #1, where overruling a
// legitimate requirements question created three unwanted files.
//
// Model calls are scripted fakes; the tool boundary is recorded.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEngineerTask, type EngineerEvent, type EngineerToolInfo } from '../src/engine/engineer/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
  { id: 'file.readRange', description: 'read', readOnly: true, inputHint: '{}' },
  { id: 'fs.proposeChangeset', description: 'propose', readOnly: false, inputHint: '{}' },
];
const SPEC = '[design specification] A hero with a headline, a two-column feature row, and a footer.';
const REFUSAL = '{"final":"I have not created or proposed any files yet. Please provide more details or clarify your request."}';
const SEARCH = '{"action":{"tool":"workspace.search","input":{"query":"index.html,styles.css,app.js"}}}';

async function drain(g: AsyncGenerator<EngineerEvent>) { const o: EngineerEvent[] = []; for await (const e of g) o.push(e); return o; }

async function run(replies: string[], input: Record<string, unknown>) {
  let i = 0; const prompts: string[] = [];
  const events = await drain(runEngineerTask({
    complete: async (p: any) => { prompts.push(typeof p === 'string' ? p : JSON.stringify(p)); return replies[Math.min(i++, replies.length - 1)]!; },
    executeTool: async (t: string, inp: any) => t === 'fs.proposeChangeset' ? { ok: true, proposalId: 'p1', ops: inp.ops } : { ok: true, matches: [] },
    tools: TOOLS, workspaceExists: () => true, noProgressLimit: 3, maxReplans: 1,
  } as any, { rootPath: '/ws', ...input } as any));
  return { events, calls: i, prompts };
}

test('A) build from a held spec: refusal after one search is corrected, and the retry proposes', async () => {
  const { events, calls, prompts } = await run(
    [SEARCH, REFUSAL, '{"action":{"tool":"fs.proposeChangeset","input":{"rootPath":"/ws","ops":[{"op":"create","path":"index.html","content":"<h1>Hero</h1>"}]}}}', '{"final":"Proposed index.html from the design."}'],
    { task: `use the mockup draft and build this page exactly as it is.\n\n${SPEC}`, intent: 'BUILD', specification: SPEC },
  );
  assert.ok(calls >= 3, `expected a re-prompt, got ${calls} model calls`);
  assert.match(prompts.join('\n'), /Call fs\.proposeChangeset NOW/, 'the build directive must reach the model');
  const proposed = events.some((e: any) => e.type === 'tool' && e.tool === 'fs.proposeChangeset') ||
    JSON.stringify(events).includes('index.html');
  assert.ok(proposed, `the corrected turn must propose files. events=${JSON.stringify(events).slice(0, 600)}`);
});

test('B) RECORD #1 MUST NOT REGRESS: no spec held, the question stands unchanged', async () => {
  const { events, calls, prompts } = await run([REFUSAL, REFUSAL], { task: 'build me a website', intent: 'BUILD' });
  assert.equal(calls, 1, 'a build with NO specification must not be re-prompted');
  assert.doesNotMatch(prompts.join('\n'), /Call fs\.proposeChangeset NOW/);
  const final = events.find((e: any) => e.type === 'final') as any;
  assert.match(final.markdown, /clarify your request/, 'the model’s own question must stand, unparaphrased');
});

test('C) a turn that PRODUCED files is never treated as a deferral', async () => {
  // Asserted on the DEFERRAL decision specifically, not on the model-call count:
  // a separate pre-existing guard corrects "let me know…" after a successful
  // proposal, and counting calls would silently credit this test to that one.
  const { events } = await run(
    ['{"action":{"tool":"fs.proposeChangeset","input":{"rootPath":"/ws","ops":[{"op":"create","path":"a.html","content":"x"}]}}}',
     '{"final":"Proposed a.html. Let me know which colours you want next."}',
     '{"final":"Proposed a.html for your approval."}'],
    { task: 'build the page', intent: 'BUILD', specification: SPEC },
  );
  assert.equal(events.filter((e: any) => e.type === 'decision').length, 0,
    'producing a proposal must keep the turn out of the deferral branch entirely');
  assert.ok(events.some((e: any) => e.type === 'proposal'), 'the proposal must survive');
});

test('D) the specification reaches the model — the wire field must not be a dead end', async () => {
  const { prompts } = await run([REFUSAL, REFUSAL, REFUSAL], {
    task: 'use the mockup draft and build this page exactly as it is.',
    intent: 'BUILD',
    specification: SPEC,
  });
  assert.match(prompts[0]!, /THE SPECIFICATION YOU WERE ASKED TO BUILD FROM/);
  assert.ok(prompts[0]!.includes(SPEC), 'the specification text itself must be in the prompt');
});

test('E) no specification means no specification block — never an empty heading', async () => {
  const { prompts } = await run([REFUSAL, REFUSAL], { task: 'build me a website', intent: 'BUILD' });
  assert.doesNotMatch(prompts[0]!, /THE SPECIFICATION YOU WERE ASKED TO BUILD FROM/);
});
