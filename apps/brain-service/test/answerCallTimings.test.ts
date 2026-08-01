// Per-model-call timing and truthful budget-exhaustion reporting.
//
// The failure these tests pin down: a repository-scale run ended after ~331s with
// a single opaque 502. That was read as one outer timeout, and it was not — it was
// two separate per-call budgets spent back to back, well inside the 360s overall
// deadline. So the assertions here are mostly about COUNTING: how many model calls
// happened, what budget each was given, and which one ran out. A run that spends a
// second full budget after the first one lapsed fails these tests.
//
// The model is a scripted local HTTP stub — no Ollama, no network, no waiting on
// real seconds. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import type { AddressInfo, Socket } from 'node:net';
import { agenticAnswer, describeTimeout } from '../src/engine/agenticAnswer.js';
import type { AnswerRunTimings, TimeoutEvidence } from '../src/engine/answerTimings.js';

/** One scripted model turn. */
type Turn =
  | { kind: 'reply'; content: string }
  | { kind: 'toolCall'; name: string; args: Record<string, unknown> }
  /** Accept the request and never answer — exercises a per-call budget lapse. */
  | { kind: 'hang' }
  | { kind: 'stream'; chunks: string[] };

interface Stub {
  baseUrl: string;
  /** One entry per request the loop actually made. */
  calls: Array<{ stream: boolean; messages: number }>;
  close(): Promise<void>;
}

async function stubModel(turns: Turn[]): Promise<Stub> {
  const calls: Stub['calls'] = [];
  const open = new Set<Socket>();
  let next = 0;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
    });
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { stream?: boolean; messages?: unknown[] };
      calls.push({ stream: parsed.stream === true, messages: (parsed.messages ?? []).length });
      const turn = turns[next] ?? { kind: 'reply' as const, content: 'no script left' };
      next += 1;
      if (turn.kind === 'hang') return; // deliberately never respond
      if (turn.kind === 'stream') {
        res.writeHead(200, { 'content-type': 'application/x-ndjson' });
        for (const chunk of turn.chunks) res.write(JSON.stringify({ message: { content: chunk }, done: false }) + '\n');
        res.end(JSON.stringify({ message: { content: '' }, done: true }) + '\n');
        return;
      }
      const message =
        turn.kind === 'toolCall'
          ? { role: 'assistant', content: '', tool_calls: [{ function: { name: turn.name, arguments: turn.args } }] }
          : { role: 'assistant', content: turn.content };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message }));
    });
  });
  server.on('connection', (s) => {
    open.add(s);
    s.on('close', () => open.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of open) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** A workspace whose only file is one the scripted model will read. */
function tmpWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-timings-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'src', 'limiter.ts'),
    ['export function throttleRequests(count: number): boolean {', '  return count <= 20;', '}', ''].join('\n'),
  );
  return dir;
}

/** A workspace with nothing to retrieve — seeding finds no evidence. */
function emptyWorkspace(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-timings-empty-')));
}

function call(t: AnswerRunTimings, index: number): AnswerRunTimings['calls'][number] {
  const c = t.calls[index - 1];
  assert.ok(c, `expected a model call #${index}, got ${t.calls.length}`);
  return c;
}

test('a normal run records one measured model call with real context sizes', async () => {
  const stub = await stubModel([{ kind: 'reply', content: '`src/limiter.ts:1-3` returns true when count is at most 20.' }]);
  try {
    const result = await agenticAnswer({
      prompt: 'what does throttleRequests do?',
      workspaceRoot: tmpWorkspace(),
      model: 'test-model',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 5_000,
      overallDeadlineMs: 20_000,
    });

    assert.equal(result.timeout, undefined, 'a completed run reports no budget exhaustion');
    assert.equal(result.timings.calls.length, 1);
    const c = call(result.timings, 1);
    assert.equal(c.callIndex, 1);
    assert.equal(c.phase, 'tool_loop');
    assert.equal(c.model, 'test-model');
    assert.equal(c.runner, 'local');
    assert.equal(c.outcome, 'ok');
    assert.equal(c.budgetMs, 5_000);
    assert.ok(c.promptChars > 0, 'prompt size is measured');
    assert.equal(c.promptMessages, 2, 'system + user');
    assert.equal(c.approxContextUnits, Math.ceil(c.promptChars / 4));
    assert.ok(c.durationMs >= 0 && c.endedAtMs >= c.startedAtMs);
    assert.equal(result.timings.lastObservedPhase, 'complete');
    assert.ok(result.timings.promptConstructionMs >= 0);
    assert.ok(result.timings.verificationMs >= 0);
  } finally {
    await stub.close();
  }
});

test('a lapsed call budget with no evidence stops at ONE call — it does not spend a second', async () => {
  const stub = await stubModel([{ kind: 'hang' }, { kind: 'reply', content: 'should never be reached' }]);
  const started = Date.now();
  try {
    const result = await agenticAnswer({
      prompt: 'zzqqx nothing matches this',
      workspaceRoot: emptyWorkspace(),
      model: 'slow-model',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 300,
      overallDeadlineMs: 30_000,
    });

    // The regression, stated as a count: the old loop answered a lapsed tool-loop
    // budget by handing synthesis a fresh full budget of its own.
    assert.equal(result.timings.calls.length, 1, `exactly one model call, got ${JSON.stringify(result.timings.calls.map((c) => c.phase))}`);
    assert.equal(stub.calls.length, 1, 'the stub was asked exactly once');
    assert.ok(Date.now() - started < 3_000, 'the run ends near the first budget, not at a multiple of it');

    const t = result.timeout as TimeoutEvidence;
    assert.ok(t, 'a budget lapse is reported');
    assert.equal(t.category, 'model_call_timeout');
    assert.equal(t.callIndex, 1);
    assert.equal(t.callBudgetMs, 300);
    assert.ok(t.elapsedMs >= 250, `elapsed reflects the real budget, got ${t.elapsedMs}`);
    assert.equal(t.contextFileCount, 0);
    assert.equal(t.lastObservedPhase, 'model_inference');
    assert.equal(t.partialEvidenceAvailable, false);
    assert.equal(t.modelCallsCompleted, 0);
    assert.equal(call(result.timings, 1).outcome, 'timeout');
    assert.equal(call(result.timings, 1).timeoutCategory, 'model_call_timeout');
    assert.match(result.answer, /Budget exhausted/);
    assert.match(result.answer, /model call #1/);
  } finally {
    await stub.close();
  }
});

test('a lapsed budget WITH evidence synthesises on what is left, at a reduced budget', async () => {
  const stub = await stubModel([
    { kind: 'toolCall', name: 'read', args: { path: 'src/limiter.ts', startLine: 1, endLine: 3 } },
    { kind: 'hang' },
    { kind: 'stream', chunks: ['`src/limiter.ts:1-3` returns true when ', 'the count is at most 20.'] },
  ]);
  try {
    const result = await agenticAnswer({
      prompt: 'what does throttleRequests do?',
      workspaceRoot: tmpWorkspace(),
      model: 'slow-model',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 400,
      overallDeadlineMs: 30_000,
    });

    assert.equal(result.timings.calls.length, 3);
    assert.equal(call(result.timings, 1).outcome, 'ok');
    assert.equal(call(result.timings, 2).outcome, 'timeout');
    assert.equal(call(result.timings, 3).phase, 'final_synthesis_stream');
    // Halved, because a model that has already overrun once is not given a fresh
    // full budget — that is precisely how one lapse became two.
    assert.equal(call(result.timings, 3).budgetMs, 200);

    const t = result.timeout as TimeoutEvidence;
    assert.equal(t.callIndex, 2, 'the FIRST lapse is reported, not the last event');
    assert.equal(t.partialEvidenceAvailable, true);
    assert.ok(t.contextFileCount >= 1, 'the lapsed call was carrying real files');
    assert.equal(t.modelCallsCompleted, 1);

    // Tool steps are attributed to the call that produced them.
    assert.equal(call(result.timings, 1).toolStepsBefore, 0);
    assert.equal(call(result.timings, 1).toolStepsAfter, 1);
    assert.equal(call(result.timings, 2).toolStepsBefore, 1);

    // The partial answer is still gated: it survives only because it is cited.
    assert.match(result.answer, /src\/limiter\.ts/);
    assert.ok(result.claims.some((c) => c.kind === 'direct_evidence'), 'the synthesised claim is evidenced');
    assert.match(result.answer, /Budget exhausted/);
  } finally {
    await stub.close();
  }
});

test('the overall deadline is reported as its own category, not as a call timeout', async () => {
  const stub = await stubModel([{ kind: 'hang' }]);
  try {
    const result = await agenticAnswer({
      prompt: 'zzqqx nothing matches this',
      workspaceRoot: emptyWorkspace(),
      model: 'slow-model',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 30_000,
      overallDeadlineMs: 400,
    });
    const t = result.timeout as TimeoutEvidence;
    assert.equal(t.category, 'overall_deadline');
    assert.equal(t.callIndex, 1);
    assert.equal(t.callBudgetMs, 30_000, 'the call budget is reported even though it was not the binding limit');
    assert.match(describeTimeout(t), /overall deadline/);
  } finally {
    await stub.close();
  }
});

test('repeated reads of the same file are counted as wasted scope', async () => {
  const stub = await stubModel([
    { kind: 'toolCall', name: 'read', args: { path: 'src/limiter.ts' } },
    { kind: 'toolCall', name: 'read', args: { path: 'src/limiter.ts' } },
    { kind: 'reply', content: '`src/limiter.ts:1-3` returns true when the count is at most 20.' },
  ]);
  try {
    const result = await agenticAnswer({
      prompt: 'what does throttleRequests do?',
      workspaceRoot: tmpWorkspace(),
      model: 'test-model',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 5_000,
      overallDeadlineMs: 20_000,
    });
    assert.deepEqual(result.timings.repeatedReads, [{ path: 'src/limiter.ts', count: 2 }]);
    assert.equal(result.timings.calls.length, 3);
    assert.ok(result.timings.toolExecutionMs >= 0);
  } finally {
    await stub.close();
  }
});

test('describeTimeout names the call and its budget — never a generic request timeout', () => {
  const text = describeTimeout({
    category: 'model_call_timeout',
    callIndex: 2,
    callBudgetMs: 150_000,
    elapsedMs: 150_004,
    contextFileCount: 7,
    lastObservedPhase: 'model_inference',
    partialEvidenceAvailable: true,
    runElapsedMs: 331_218,
    modelCallsCompleted: 1,
  });
  assert.match(text, /model call #2/);
  assert.match(text, /150s budget/);
  assert.match(text, /7 file\(s\)/);
  assert.match(text, /model_inference/);
  assert.ok(!/request timed out/i.test(text), 'the whole request is not blamed for one call');
});

test('the cloud runner is carried through to the timing rows', async () => {
  const stub = await stubModel([{ kind: 'reply', content: '`src/limiter.ts:1-3` returns true when the count is at most 20.' }]);
  try {
    const result = await agenticAnswer({
      prompt: 'what does throttleRequests do?',
      workspaceRoot: tmpWorkspace(),
      model: 'gpt-oss:120b-cloud',
      runner: 'cloud',
      providerBaseUrl: stub.baseUrl,
      perCallTimeoutMs: 5_000,
      overallDeadlineMs: 20_000,
    });
    assert.equal(result.runner, 'cloud');
    assert.equal(call(result.timings, 1).runner, 'cloud');
  } finally {
    await stub.close();
  }
});
