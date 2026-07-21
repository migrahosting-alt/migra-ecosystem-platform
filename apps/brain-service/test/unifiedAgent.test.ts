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
import { camelCandidates } from '../src/retrieval/retrieve.js';
import { runEngineerTask, parseStep, claimedUnrunTool, repairJsonEscapes, repairJsonControlChars, type EngineerEvent, type EngineerToolInfo } from '../src/engine/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
  { id: 'file.readRange', description: 'read', readOnly: true, inputHint: '{}' },
  { id: 'diagnostics.get', description: 'compiler diagnostics', readOnly: true, inputHint: '{}' },
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

test('handing the work back to the user without looking is challenged, not delivered', async () => {
  const h = harness([
    '{"final":"Sorry, but I don\'t have the necessary information. Could you please specify which commands were executed?"}',
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"x"}}}',
    '{"final":"The workspace is empty: no files, no commits, and no commands were run in this session."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'report what is in this repo' }));

  assert.match(h.prompts[1]!, /puts the work back on the user/);
  assert.deepEqual(h.calls, ['workspace.search'], 'it looks instead of punting');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /The workspace is empty/);
});

test('the agent never asks the user to do its looking (observed on the real monorepo)', async () => {
  // Verbatim shapes that ended a turn with zero tool calls. The middle one is the
  // one that slipped past a refusal-only check: it ANNOUNCES an inspection it
  // never performs, which reads as helpful and is the same dead-end.
  for (const punt of [
    'Please guide me on where to look so I can fulfill your request.',
    'I need to inspect the code to answer accurately. If you can provide the specific path, I can search it.',
    'Could you tell me which file defines the loop?',
    'Let me know which directory holds the engine and I will take it from there.',
  ]) {
    const h = harness([
      JSON.stringify({ final: punt }),
      '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"engineer loop"}}}',
      '{"final":"The loop lives in src/engine/engineerRuntime.ts:410 and drives a JSON action/final protocol."}',
    ]);
    const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'where is the engineer loop?' }));

    assert.deepEqual(h.calls, ['workspace.search'], `should look instead of asking: ${punt.slice(0, 40)}…`);
    const final = events.find((e) => e.type === 'final') as { markdown: string };
    assert.match(final.markdown, /engineerRuntime\.ts/);
  }
});

test('the correction is safe when the question did NOT need the workspace', async () => {
  // A false positive must cost one round, never a wrong answer — so the directive
  // explicitly permits answering directly when the workspace is irrelevant.
  const h = harness([
    '{"final":"Could you tell me which language you mean, so I can answer precisely?"}',
    '{"final":"A monad wraps a value and defines bind; Promise.then is the classic example of that shape."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what is a monad?' }));

  assert.match(h.prompts[1]!, /does not depend on the workspace, answer from your own/);
  assert.deepEqual(h.calls, [], 'no pointless search for a general question');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Promise\.then/);
});

test('the workspace-question rule tells the model to search rather than ask', async () => {
  const h = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi' }));
  const prompt = h.prompts[0]!;
  assert.match(prompt, /Your FIRST reply MUST be a tool call/);
  assert.match(prompt, /never ask the user where to look/);
});

// ── a correct answer must never be discarded over JSON formatting ─────────────

test('multi-line markdown with RAW newlines inside the JSON string still parses', () => {
  // Verbatim shape from a live repo question: a fully-cited answer whose bullet
  // list used real newlines instead of \n. JSON forbids that, so the whole
  // 45-second run was reported as a failure and the answer thrown away.
  const reply = '```json\n{"final":"**The engineer loop is here:**\n\n- `src/engine/engineerRuntime.ts` (line 410)\n"}\n```';
  assert.throws(() => JSON.parse(reply.replace(/^```json\n|\n```$/g, '')), 'precondition: really invalid JSON');

  const step = parseStep(reply) as { kind: string; markdown: string };
  assert.equal(step.kind, 'final');
  assert.match(step.markdown, /engineerRuntime\.ts` \(line 410\)/);
  assert.match(step.markdown, /\n\n- /, 'the line structure is preserved, not flattened');
});

test('control-char repair leaves already-valid JSON byte-identical', () => {
  const valid = JSON.stringify({ final: 'line one\nline two\ttabbed "quoted" \\ backslash' });
  assert.equal(repairJsonControlChars(valid), valid);
  assert.deepEqual(JSON.parse(repairJsonControlChars(valid)), JSON.parse(valid));
});

test('prose written instead of the protocol is accepted as the answer after real work', async () => {
  const h = harness([
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"engineer loop"}}}',
    'The engineer loop lives in `src/engine/engineerRuntime.ts:410`. It drives a JSON protocol where each step is either an action or a final, and it never applies edits itself.',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'where is the engineer loop?' }));

  assert.equal(events.find((e) => e.type === 'error'), undefined, 'a good answer is not a failure');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /engineerRuntime\.ts:410/);
});

test('a half-formed tool call is NOT mistaken for an answer', async () => {
  // Acting on a guess is far worse than reporting the protocol break.
  const h = harness([
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"x"}}}',
    'I will now run {"tool": "command.run", "input": {"command": ["rm", "-rf", "dist"]}} to clean the build output for you.',
    'still not protocol',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'clean the build' }));
  const err = events.find((e) => e.type === 'error') as { code: string } | undefined;
  assert.equal(err?.code, 'MALFORMED_MODEL_OUTPUT');
  assert.deepEqual(h.calls, ['workspace.search'], 'the guessed command never ran');
});

// ── never report the result of a tool that never ran ─────────────────────────

test('claiming a search result after calling a different tool is challenged', async () => {
  // Observed live: called only diagnostics.get, then answered "the workspace
  // search did not find any specific information…" and gave up.
  const h = harness([
    '{"action":{"tool":"diagnostics.get","input":{"rootPath":"/w"}}}',
    '{"final":"The workspace search did not find any information about the changeset lint in this repository."}',
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"lintChangeset"}}}',
    '{"final":"changesetLint.ts flags empty content, merge markers, leaked tool-call markup, invalid JSON and duplicate definitions."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the changeset lint check?' }));

  assert.match(h.prompts[2]!, /You did NOT call workspace\.search/);
  assert.deepEqual(h.calls, ['diagnostics.get', 'workspace.search'], 'it runs the search it claimed');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /merge markers/);
});

test('reporting a tool it DID call is left alone', async () => {
  const h = harness([
    '{"action":{"tool":"workspace.search","input":{"rootPath":"/w","query":"lintChangeset"}}}',
    '{"final":"The workspace search found lintChangeset in src/tools/changesetLint.ts, which flags merge markers and empty content."}',
  ]);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the changeset lint check?' }));
  assert.equal(h.prompts.length, 2, 'no wasted corrective round');
});

test('claimedUnrunTool matches the spoken form as well as the dotted id', () => {
  const available = ['workspace.search', 'file.readRange', 'diagnostics.get'];
  const ran = new Set(['diagnostics.get']);
  assert.equal(claimedUnrunTool('the workspace search found nothing', ran, available), 'workspace.search');
  assert.equal(claimedUnrunTool('workspace.search returned no hits', ran, available), 'workspace.search');
  assert.equal(claimedUnrunTool('diagnostics.get returned no items', ran, available), null, 'it really ran');
  assert.equal(claimedUnrunTool('I read the file and found the answer', ran, available), null, 'no tool named');
});

// ── seeded grounding ─────────────────────────────────────────────────────────
// Routing ordinary turns to this loop dropped the chat path's tuned lexical
// retrieval in favour of a naive keyword search. On the real monorepo that made
// "what does the changeset lint check?" match allowed-scripts config and a
// deployment doc instead of changesetLint.ts. The excerpts are seeded back in.

const SEEDED = [
  { path: 'src/tools/changesetLint.ts', startLine: 20, endLine: 24, snippet: "defects.push({ path, issue: 'contains merge-conflict markers' });" },
];

test('seeded excerpts are shown to the model with their real path:line', async () => {
  const h = harness(['{"final":"changesetLint.ts:20 flags merge-conflict markers in proposed content."}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the changeset lint check?', context: SEEDED }));

  const prompt = h.prompts[0]!;
  assert.match(prompt, /CODE RETRIEVED FOR THIS MESSAGE/);
  assert.match(prompt, /--- src\/tools\/changesetLint\.ts:20-24/);
  assert.match(prompt, /merge-conflict markers/);
});

test('with excerpts the agent may answer immediately; without them it must search first', async () => {
  const withCtx = harness(['{"final":"changesetLint.ts:20 flags merge-conflict markers in proposed content."}']);
  await drain(runEngineerTask(withCtx.deps, { rootPath: '/w', task: 'what does the lint check?', context: SEEDED }));
  assert.match(withCtx.prompts[0]!, /read them FIRST and answer/);
  assert.doesNotMatch(withCtx.prompts[0]!, /Your FIRST reply MUST be a tool call/);
  assert.deepEqual(withCtx.calls, [], 'a sufficient excerpt saves a search round');

  const noCtx = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(noCtx.deps, { rootPath: '/w', task: 'what does the lint check?' }));
  assert.match(noCtx.prompts[0]!, /Your FIRST reply MUST be a tool call/);
});

test('seeded excerpts are framed as a SAMPLE, so absence is never proof', async () => {
  const h = harness(['{"final":"changesetLint.ts:20 flags merge-conflict markers in proposed content."}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the lint check?', context: SEEDED }));
  const prompt = h.prompts[0]!;
  assert.match(prompt, /a SAMPLE, not the whole repo/);
  assert.match(prompt, /never claim the repo lacks something merely because these excerpts omit it/);
});

test('no excerpts means no empty section in the prompt', async () => {
  const h = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi', context: [] }));
  assert.doesNotMatch(h.prompts[0]!, /CODE RETRIEVED FOR THIS MESSAGE/);
});



// ── retrieval: the candidate pool is what actually decides the answer ─────────

test('camelCandidates joins adjacent query words the way code is actually named', () => {
  // "what does the changeset lint check?" must reach `changesetLint.ts`. Searching
  // the words separately drowned in every eslint config in the tree; the joined
  // identifier hits the one file that implements it.
  assert.ok(camelCandidates('what defects does the changeset lint check for?').includes('changesetLint'));
  assert.ok(camelCandidates('where is the workspace search implemented').includes('workspaceSearch'));
  // Filler words are dropped, so no `theChangeset` / `doesThe` noise.
  assert.deepEqual(camelCandidates('what is this'), []);
  assert.ok(!camelCandidates('what does the changeset lint check for?').some((c) => /^the|^does|^what/.test(c)));
});

// ── protocol tolerance: the answer is the answer, whatever it is wrapped in ───

test('a final under a different key is still a final, not a dead end', async () => {
  // Observed live: `{"response":"…"}` and a bare JSON string. Both parse fine as
  // JSON, so the run died with "neither action nor final" and lost the answer.
  for (const reply of [
    '{"response":"A monad sequences computations and handles effects."}',
    '{"answer":"A monad sequences computations and handles effects."}',
    '"A monad sequences computations and handles effects."',
  ]) {
    // Strict first: the protocol is demanded, and the retry usually complies.
    assert.equal((parseStep(reply) as { kind: string }).kind, 'malformed', `strict rejects: ${reply.slice(0, 30)}…`);
    const step = parseStep(reply, { lenient: true }) as { kind: string; markdown: string };
    assert.equal(step.kind, 'final', `lenient rescues: ${reply.slice(0, 30)}…`);
    assert.match(step.markdown, /A monad sequences computations/);
  }
});

test('an alias key never overrides a real action', async () => {
  const step = parseStep('{"action":{"tool":"workspace.search","input":{}},"response":"searching now"}', { lenient: true }) as { kind: string; tool: string };
  assert.equal(step.kind, 'action');
  assert.equal(step.tool, 'workspace.search');
});

test('an empty alias value does not count as an answer', async () => {
  assert.equal((parseStep('{"response":"   "}', { lenient: true }) as { kind: string }).kind, 'malformed');
});

// ── the model picker must reach the agent ────────────────────────────────────
// Ordinary turns used to hit the chat endpoint, which honors a pinned model id.
// Routing them to the agent silently dropped the pin: the picker still looked
// like it worked while the engine quietly chose by tier.

test('a pinned model wins over tier ranking when it is eligible', async () => {
  const { rankLocalModels } = await import('../src/engine/providers/localCodingRouter.js');
  const providers = [
    {
      provider: { id: 'local', kind: 'local', enabled: true, health: { status: 'ok' } },
      models: [
        { id: 'qwen2.5-coder:7b', tier: 'fast', capabilities: { chat: true, tools: true, coding: true } },
        { id: 'qwen2.5-coder:14b', tier: 'balanced', capabilities: { chat: true, tools: true, coding: true } },
        { id: 'qwen3-coder:30b', tier: 'deep', capabilities: { chat: true, tools: true, coding: true } },
      ],
    },
  ] as unknown as Parameters<typeof rankLocalModels>[0];

  // Without a pin, the requested tier decides.
  assert.equal(rankLocalModels(providers, { tier: 'balanced', needsTools: true })[0]!.id, 'qwen2.5-coder:14b');
  // With a pin, the user's explicit choice wins even against the tier.
  assert.equal(
    rankLocalModels(providers, { tier: 'balanced', needsTools: true, model: 'qwen3-coder:30b' })[0]!.id,
    'qwen3-coder:30b',
  );
  // A pin that is not eligible must not empty the list — fall back to ranking.
  assert.equal(
    rankLocalModels(providers, { tier: 'fast', needsTools: true, model: 'not-installed:70b' })[0]!.id,
    'qwen2.5-coder:7b',
  );
});

// ── retrieval depth: a definition is read to its END ─────────────────────────
// A fixed radius truncated real symbols: `lintChangeset` runs past a 24-line
// window, so the excerpt omitted its duplicate-definition check and the answer
// was correct but INCOMPLETE.

test('definitionEndLine follows braces to the end of the symbol', async () => {
  const { definitionEndLine } = await import('../src/retrieval/retrieve.js');
  const lines = [
    'export function lint(ops) {', //  1
    '  const defects = [];',       //  2
    '  for (const op of ops) {',   //  3
    '    if (op.empty) {',         //  4
    '      defects.push(1);',      //  5
    '    }',                       //  6
    '  }',                         //  7
    '  return defects;',           //  8
    '}',                           //  9  <- the real end
    'const after = 1;',            // 10
  ];
  assert.equal(definitionEndLine(lines, 1, 120), 9);
});

test('an unbalanced or oversized definition falls back to the default window', async () => {
  const { definitionEndLine } = await import('../src/retrieval/retrieve.js');
  assert.equal(definitionEndLine(['function broken() {', '  return 1;'], 1, 120), 0, 'never closed');
  assert.equal(definitionEndLine(['function big() {', '  a();', '  b();', '}'], 1, 1), 0, 'beyond the span cap');
});

test('indented languages end at the next line that dedents', async () => {
  const { indentedBlockEndLine } = await import('../src/retrieval/retrieve.js');
  const lines = [
    'def lint(ops):',      // 1
    '    defects = []',    // 2
    '    for op in ops:',  // 3
    '        pass',        // 4
    '    return defects',  // 5  <- last line of the def
    '',                    // 6
    'def other():',        // 7
  ];
  assert.equal(indentedBlockEndLine(lines, 1, 120), 5);
});

// ── the seeded code must actually be used ────────────────────────────────────
// Checked by CITATION, not wording. An earlier phrase-matching guard for "the
// excerpts do not cover it" slipped on every rewording and was deleted; wording
// varies endlessly, citations do not.

test('an answer that ignores the code it was handed is sent back', async () => {
  const h = harness([
    '{"final":"The provided excerpts do not include specific details. I would need to search the repository."}',
    '{"final":"changesetLint.ts:21 flags empty content, merge markers, leaked tool-call markup and invalid JSON."}',
  ]);
  const events = await drain(
    runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the changeset lint check?', context: SEEDED }),
  );

  assert.match(h.prompts[1]!, /your answer cites none of it/);
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /merge markers/);
});

test('an answer that cites the seeded file is accepted as-is', async () => {
  const h = harness([
    '{"final":"changesetLint.ts:20 flags merge-conflict markers before a proposal is shown."}',
  ]);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'what does the lint check?', context: SEEDED }));
  assert.equal(h.prompts.length, 1, 'no wasted corrective round');
});

test('with nothing seeded the citation check never fires', async () => {
  const { ignoredSeededContext } = await import('../src/engine/engineerRuntime.js');
  assert.equal(ignoredSeededContext('any answer at all', []), false);
  assert.equal(ignoredSeededContext('see src/tools/changesetLint.ts', SEEDED), false);
  assert.equal(ignoredSeededContext('I could not find anything', SEEDED), true);
});

// ── a build order must never become a search ─────────────────────────────────
// Observed by the owner: "build thesystem" made the agent run
// workspace.search("build thesystem"), find nothing, and reply "I did not find
// any files matching… Please provide more details." Nothing was built. The
// thing it searched for does not exist YET — that is why it was asked for.

test('the prompt forbids searching for something it is being asked to create', async () => {
  const h = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'hi' }));
  const prompt = h.prompts[0]!;
  assert.match(prompt, /DO NOT SEARCH FOR SOMETHING YOU ARE BEING ASKED TO CREATE/);
  assert.match(prompt, /is never a valid answer/);
});

test('the deferral correction tells a BUILD request to build, not to search', async () => {
  const h = harness([
    '{"final":"I did not find any files matching \'thesystem\' in your workspace. Please provide more details."}',
    '{"action":{"tool":"fs.proposeChangeset","input":{"rootPath":"/w","ops":[{"op":"create","path":"index.html","content":"<!doctype html>"}]}}}',
    '{"final":"Proposed index.html as the starting point for the system; review and apply it."}',
  ]);
  const events = await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'build thesystem' }));

  const directive = h.prompts[1]!;
  assert.match(directive, /searching for it is the\s+WRONG move/);
  assert.match(directive, /Call fs\.proposeChangeset NOW/);
  assert.deepEqual(h.calls, ['fs.proposeChangeset'], 'it builds instead of searching again');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Proposed index\.html/);
});

test('seeded excerpts are declared BACKGROUND for a build request', async () => {
  const h = harness(['{"final":"a sufficiently long direct answer for the agent to accept it"}']);
  await drain(runEngineerTask(h.deps, { rootPath: '/w', task: 'build it', context: SEEDED }));
  assert.match(h.prompts[0]!, /these excerpts are BACKGROUND\s+ONLY/);
});
