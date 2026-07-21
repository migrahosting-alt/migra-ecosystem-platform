// Unified workspace agent — ONE path that both answers and acts.
//
// Background: routing used to fork on a keyword classifier, so PHRASING decided
// whether a turn could touch the workspace at all. A build order that missed the
// regex landed on a tool-less path and, asked for a completion report it could
// not produce, invented one. These tests pin the loop-side guarantees that make
// the single path viable: it may answer a question immediately (no tools, no
// completion-report badgering), it still enforces a real report once it has done
// work, and it carries conversation history.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runEngineerTask, parseStep, repairJsonEscapes, type EngineerEvent, type EngineerToolInfo } from '../src/engine/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
  { id: 'fs.proposeChangeset', description: 'propose', readOnly: false, inputHint: '{}' },
];

/** Scripted model replies; records every prompt the model was shown. */
function harness(replies: string[]): {
  deps: Parameters<typeof runEngineerTask>[0];
  prompts: string[];
  calls: string[];
} {
  const prompts: string[] = [];
  const calls: string[] = [];
  let i = 0;
  return {
    prompts,
    calls,
    deps: {
      complete: async (prompt: string) => {
        prompts.push(prompt);
        return replies[Math.min(i++, replies.length - 1)]!;
      },
      executeTool: async (tool: string) => {
        calls.push(tool);
        return { ok: true };
      },
      tools: TOOLS,
    },
  };
}

async function drain(gen: AsyncGenerator<EngineerEvent>): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

test('a plain question is answered on step 1 — no tools, no completion-report badgering', async () => {
  // Short, conversational, and contains a deferral phrase ("let me know") — all
  // three used to trip the weak-final corrector and force a bogus retry.
  const h = harness(['{"final":"A monad is a wrapper type. Let me know if you want an example."}']);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'What is a monad?' }));

  assert.deepEqual(h.calls, [], 'answering a question uses no tools');
  assert.equal(h.prompts.length, 1, 'exactly one model call — no corrective retry');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /A monad is a wrapper type/);
});

test('an empty direct answer is still corrected — but asked for the ANSWER, not a work report', async () => {
  const h = harness(['{"final":"   "}', '{"final":"A monad is a wrapper type with bind and unit."}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'What is a monad?' }));

  assert.equal(h.prompts.length, 2, 'one corrective retry');
  const directive = h.prompts[1]!;
  assert.match(directive, /Your final was empty/);
  assert.doesNotMatch(directive, /which commands you actually/, 'never demands a work report for a question');
});

test('once tools have run, a weak final IS still corrected (work must be reported honestly)', async () => {
  const h = harness([
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"x"}}}',
    '{"final":"Done."}',
    '{"final":"Searched the workspace for `x`, found no matches, and proposed no changes."}',
  ]);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'find every use of x' }));

  assert.deepEqual(h.calls, ['workspace.search']);
  assert.ok(
    h.prompts.some((p) => /must be a real completion report/.test(p)),
    'a two-word final after real work is still challenged',
  );
});

test('the agent prompt tells the model to decide answer-vs-act, and never gates on wording', async () => {
  const h = harness(['{"final":"ok — a sufficiently long direct answer for the agent to accept."}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi' }));

  const prompt = h.prompts[0]!;
  assert.match(prompt, /answer it IMMEDIATELY/, 'questions are answered, not routed away');
  assert.match(prompt, /the WORDING never decides; the INTENT does/, 'phrasing must not gate capability');
  assert.match(prompt, /numbered slice, a quoted instruction/, 'the historically-stranded phrasings are named');
});

test('conversation history reaches the agent, so a follow-up like "now build it" has a referent', async () => {
  const h = harness(['{"final":"a sufficiently long final answer to satisfy the loop guard"}']);
  await drain(
    runEngineerTask(h.deps, {
      rootPath: '/w',
      task: 'now build it',
      history: [
        { role: 'user', text: 'design a health poller' },
        { role: 'assistant', text: 'It polls /health every 30s and records latency.' },
      ],
    }),
  );

  const prompt = h.prompts[0]!;
  assert.match(prompt, /CONVERSATION SO FAR:/);
  assert.match(prompt, /User: design a health poller/);
  assert.match(prompt, /You: It polls \/health every 30s/);
  assert.match(prompt, /THE USER'S CURRENT MESSAGE: now build it/);
});

test('history is omitted entirely when there is none (no empty section in the prompt)', async () => {
  const h = harness(['{"final":"a sufficiently long final answer to satisfy the loop guard"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi' }));
  assert.doesNotMatch(h.prompts[0]!, /CONVERSATION SO FAR:/);
});

// ── protocol robustness: a run must not die on a stray escape ─────────────────
// Observed live: qwen wrote `alert('Time\'s up!')` into a proposed .js file. That
// `\'` is invalid JSON, so the entire (otherwise perfect) 3-file build run failed
// with MALFORMED_MODEL_OUTPUT. Never dead-end on something this recoverable.

test('a JS-style escape inside proposed file content no longer kills the step', () => {
  const reply = String.raw`{"action":{"tool":"fs.proposeChangeset","input":{"ops":[{"op":"create","path":"app.js","content":"alert('Time\'s up!')"}]}}}`;
  assert.throws(() => JSON.parse(reply), 'precondition: raw reply really is invalid JSON');

  const step = parseStep(reply) as { kind: string; tool: string; input: { ops: Array<{ content: string }> } };
  assert.equal(step.kind, 'action');
  assert.equal(step.tool, 'fs.proposeChangeset');
  assert.equal(step.input.ops[0]!.content, "alert('Time's up!')");
});

test('escape repair leaves valid JSON escapes untouched', () => {
  assert.equal(repairJsonEscapes(String.raw`{"a":"line\nbreak \"q\" \\ é"}`), String.raw`{"a":"line\nbreak \"q\" \\ é"}`);
  const parsed = JSON.parse(repairJsonEscapes(String.raw`{"a":"tab\there é \'x\'"}`)) as { a: string };
  assert.equal(parsed.a, "tab\there é 'x'");
});

test('genuinely unparseable output is still reported as malformed (no false rescue)', () => {
  assert.equal((parseStep('I will now build the app for you!') as { kind: string }).kind, 'malformed');
});

test('repair never eats the partner of an escaped backslash', () => {
  // `"a\\"` is a valid one-character string containing a backslash. A naive
  // left-to-right scan reads the SECOND backslash as starting a new escape and
  // silently deletes it, corrupting content that was already correct.
  const parsed = JSON.parse(repairJsonEscapes(String.raw`{"p":"C:\\dir\\file","bad":"it\'s"}`)) as { p: string; bad: string };
  assert.equal(parsed.p, String.raw`C:\dir\file`);
  assert.equal(parsed.bad, "it's");
});

// ── phantom work: a claim of work with ZERO tool calls behind it ──────────────
// Observed live: after a design discussion, "you can now build the system" made
// the agent reply "…*app.js* starts the countdown … No further actions are
// pending" — having proposed nothing at all. Same phantom report as the
// fabricated Slice 0 run, reached from the tool-capable path.

test('a claim of work with no tool calls is challenged, and the retry can do the work', async () => {
  const h = harness([
    '{"final":"index.html holds the markup and app.js starts the countdown. No further actions are pending."}',
    '{"action":{"tool":"fs.proposeChangeset","input":{"rootPath":"/w","ops":[{"op":"create","path":"app.js","content":"x"}]}}}',
    '{"final":"Proposed app.js implementing the countdown; review and apply it."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'you can now build the system' }));

  assert.match(h.prompts[1]!, /You called NO tools this turn/);
  assert.deepEqual(h.calls, ['fs.proposeChangeset'], 'the correction leads to real work');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.doesNotMatch(final.markdown, /Nothing was created or changed/, 'real work needs no warning');
});

test('a phantom claim that survives its correction is overridden with the ground truth', async () => {
  const h = harness(['{"final":"I have created index.html, styles.css and app.js for the countdown timer."}']);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'build the timer' }));

  assert.deepEqual(h.calls, [], 'the model never actually did anything');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Nothing was created or changed/);
  assert.match(final.markdown, /do not exist/);
});

test('an ordinary answer that merely discusses code is not flagged as phantom work', async () => {
  const h = harness([
    '{"final":"A monad wraps a value and defines bind. In JavaScript, Promise.then is the classic example of that shape."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what is a monad?' }));
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.doesNotMatch(final.markdown, /Nothing was created or changed/, 'no false alarm on a plain answer');
  assert.equal(h.prompts.length, 1, 'and no corrective retry');
});

test('the observed phantom shapes are all caught (past-tense file bullets, "Proposal Recorded")', async () => {
  // Both taken verbatim from live runs that claimed work after zero tool calls.
  for (const phantom of [
    '**Proposal Recorded**.\n\n- **index.html**: Created a basic HTML structure with an input.\n- **app.js**: Implemented the countdown logic.',
    'index.html holds the markup and app.js starts the countdown. No further actions are pending.',
  ]) {
    const h = harness([JSON.stringify({ final: phantom })]);
    const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'you can now build the system' }));
    const final = events.find((e) => e.type === 'final') as { markdown: string };
    assert.match(final.markdown, /Nothing was created or changed/, `should be caught: ${phantom.slice(0, 40)}…`);
  }
});

test('advice and explanation are not mistaken for a completion report', async () => {
  for (const benign of [
    'You could start by creating index.html, then add app.js for the countdown logic.',
    'In React, index.js imports App.js and renders it into the DOM node in index.html.',
    'The repository has no build step configured, so `npm test` is the only gate here.',
  ]) {
    const h = harness([JSON.stringify({ final: benign })]);
    const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'how does this work?' }));
    const final = events.find((e) => e.type === 'final') as { markdown: string };
    assert.doesNotMatch(final.markdown, /Nothing was created or changed/, `false alarm on: ${benign.slice(0, 40)}…`);
    assert.equal(h.prompts.length, 1, 'and no wasted corrective retry');
  }
});

// ── never throw away real work, never punt without looking ────────────────────

test('proposals survive a model that breaks protocol on its summary step', async () => {
  // Observed live: a build proposed index.html/styles.css/app.js, then emitted
  // prose instead of JSON — and the entire run surfaced as "Engineer run failed"
  // with the finished proposals stranded above the error.
  const h = harness([
    '{"action":{"tool":"fs.proposeChangeset","input":{"rootPath":"/w","ops":[{"op":"create","path":"app.js","content":"x"}]}}}',
    'Great — the countdown timer is all set!',
    'Still not JSON, sorry.',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'build the timer' }));

  assert.equal(events.find((e) => e.type === 'error'), undefined, 'a completed build is not reported as a failure');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Recorded 1 proposal/);
  assert.match(final.markdown, /machine-generated/, 'the summary is honest about its origin');
  assert.match(final.markdown, /NOT applied/, 'and still carries the preview-only truth');
});

test('a malformed run with NO proposals still fails honestly (nothing to salvage)', async () => {
  const h = harness(['not json', 'still not json']);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'build the timer' }));
  const err = events.find((e) => e.type === 'error') as { code: string };
  assert.equal(err.code, 'MALFORMED_MODEL_OUTPUT');
});

test('"I don\'t have enough information" without using a tool is challenged, not delivered', async () => {
  const h = harness([
    '{"final":"Sorry, but I don\'t have the necessary information. Could you please specify which commands were executed?"}',
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"x"}}}',
    '{"final":"The workspace is empty: no files, no commits, and no commands were run in this session."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'report what is in this repo' }));

  assert.match(h.prompts[1]!, /you used none of them/);
  assert.deepEqual(h.calls, ['workspace.search'], 'it looks instead of punting');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /The workspace is empty/);
});
