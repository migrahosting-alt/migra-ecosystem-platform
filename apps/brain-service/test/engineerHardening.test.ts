// Slice 3A — engineer loop hardening. Model calls are scripted fakes; tool
// execution + filesystem effects are recorded so behavior is deterministic.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  runEngineerTask,
  normalizeInput,
  stableStringify,
  deniedCommandReason,
  isWeakFinal,
  type EngineerEvent,
  type EngineerToolInfo,
} from '../src/engine/engineerRuntime.js';

const TOOLS: EngineerToolInfo[] = [
  { id: 'file.readRange', description: 'read', readOnly: true, inputHint: '{}' },
  { id: 'workspace.search', description: 'search', readOnly: true, inputHint: '{}' },
  { id: 'edit.preview', description: 'preview', readOnly: true, inputHint: '{}' },
  { id: 'command.run', description: 'run', readOnly: false, inputHint: '{}' },
];

interface Harness {
  deps: Parameters<typeof runEngineerTask>[0];
  calls: Array<{ tool: string; input: unknown }>;
}

function harness(
  replies: string[],
  opts: { results?: (tool: string, input: unknown, i: number) => unknown; listFiles?: () => string[][] } = {},
): Harness {
  const calls: Array<{ tool: string; input: unknown }> = [];
  let i = 0;
  let listIdx = 0;
  const lists = opts.listFiles?.() ?? [];
  return {
    calls,
    deps: {
      complete: async () => replies[Math.min(i++, replies.length - 1)]!,
      executeTool: async (tool: string, input: unknown) => {
        const idx = calls.length;
        calls.push({ tool, input });
        return opts.results ? opts.results(tool, input, idx) : { tool, ok: true };
      },
      listFiles: opts.listFiles ? async () => lists[Math.min(listIdx++, lists.length - 1)] ?? [] : undefined,
      tools: TOOLS,
      noProgressLimit: 3,
      maxReplans: 1,
    },
  };
}

async function drain(gen: AsyncGenerator<EngineerEvent>): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

// ── unit helpers ────────────────────────────────────────────────────────────────

test('stableStringify canonicalizes key order (equivalent inputs match)', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.notEqual(stableStringify({ a: 1 }), stableStringify({ a: 2 }));
});

test('normalizeInput repairs a safe absolute path under root to relative', () => {
  const r = normalizeInput({ path: '/ws/src/index.js', startLine: 1, endLine: 2 }, '/ws');
  assert.ok(!('rejection' in r));
  if (!('rejection' in r)) {
    assert.equal(r.input.path, 'src/index.js');
    assert.ok(r.notes.some((n) => /normalized absolute path/.test(n)));
  }
});

test('normalizeInput rejects a path outside root and traversal escapes', () => {
  assert.ok('rejection' in normalizeInput({ path: '/etc/passwd' }, '/ws'));
  assert.ok('rejection' in normalizeInput({ path: '../secrets' }, '/ws'));
});

test('normalizeInput normalizes line coordinates deterministically (1-based)', () => {
  const r = normalizeInput({ path: 'a.ts', startLine: 0, endLine: 0 }, '/ws');
  assert.ok(!('rejection' in r));
  if (!('rejection' in r)) {
    assert.equal(r.input.startLine, 1);
    assert.equal(r.input.endLine, 1);
  }
  const r2 = normalizeInput({ changes: [{ path: 'a.ts', startLine: 5, endLine: 2, replacement: 'x' }] }, '/ws');
  if (!('rejection' in r2)) {
    assert.equal((r2.input.changes as Array<{ endLine: number }>)[0]!.endLine, 5);
  }
});

test('deniedCommandReason refuses publish/deploy/release/push; allows build/test', () => {
  assert.match(deniedCommandReason(['npm', 'publish']) ?? '', /external-effect/);
  assert.match(deniedCommandReason(['npm', 'run', 'deploy']) ?? '', /external-effect/);
  assert.equal(deniedCommandReason(['npm', 'test']), null);
  assert.equal(deniedCommandReason(['npm', 'install']), null);
});

test('isWeakFinal flags empty, trivial, and deferral finals', () => {
  assert.equal(isWeakFinal(''), true);
  assert.equal(isWeakFinal('ok'), true);
  assert.equal(isWeakFinal('Continuing setup.'), true);
  assert.equal(isWeakFinal('Please confirm if you want to proceed with these steps now.'), true);
  assert.equal(isWeakFinal('Inspected package.json, ran npm install (ok), proposed src/index.js; no tests yet.'), false);
});

// ── loop behavior ────────────────────────────────────────────────────────────────

test('duplicate command executes only once; the model is told it already ran', async () => {
  const { deps, calls } = harness([
    '{"action":{"tool":"workspace.search","input":{"query":"x"}}}',
    '{"action":{"tool":"workspace.search","input":{"query":"x"}}}',
    '{"final":"Searched for x once; result reused on the repeat. Nothing else to do."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.equal(calls.length, 1, 'the identical second call must not execute');
  assert.ok(events.some((e) => e.type === 'note' && e.kind === 'duplicate'));
});

test('equivalent normalized command executes only once (key order + absolute path)', async () => {
  const { deps, calls } = harness([
    '{"action":{"tool":"file.readRange","input":{"path":"a.ts","startLine":1,"endLine":5}}}',
    // Same call, keys reordered + absolute path under root → canonicalizes equal.
    '{"action":{"tool":"file.readRange","input":{"endLine":5,"startLine":1,"path":"/ws/a.ts"}}}',
    '{"final":"Read a.ts (lines 1-5) once; the equivalent repeat reused it. Done."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.equal(calls.length, 1, 'the normalized-equivalent call must not re-execute');
  assert.ok(events.some((e) => e.type === 'note' && e.kind === 'duplicate'));
});

test('path outside root is rejected as a note; the tool is not executed', async () => {
  const { deps, calls } = harness([
    '{"action":{"tool":"file.readRange","input":{"path":"/etc/passwd"}}}',
    '{"final":"That path was outside the workspace and refused; nothing read. Done."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.equal(calls.length, 0, 'out-of-root path must never execute');
  assert.ok(events.some((e) => e.type === 'note' && /outside the workspace root/.test(e.message)));
});

test('repeated no-progress forces one re-plan then terminates with LOOP_NO_PROGRESS', async () => {
  // The model keeps issuing DIFFERENT searches that all return the SAME result,
  // so every step is a novel call but a repeated observation → no progress.
  const { deps } = harness(Array(20).fill('{"action":{"tool":"workspace.search","input":{"query":"__UNIQUE__"}}}').map((s, k) => s.replace('__UNIQUE__', `q${k}`)), {
    results: () => ({ tool: 'workspace.search', matches: [] }), // identical result every time
  });
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.ok(events.some((e) => e.type === 'note' && e.kind === 'replan'), 'a re-plan must be forced first');
  const last = events.at(-1)!;
  assert.equal(last.type, 'error');
  assert.equal((last as { code: string }).code, 'LOOP_NO_PROGRESS');
});

test('weak final receives exactly one correction, then the improved final is accepted', async () => {
  // The corrector applies to WORK turns — a turn that used tools owes a real
  // completion report. (A question answered on step 1 with no tools is exempt;
  // see unifiedAgent.test.ts.) So the script does one tool step first.
  let completions = 0;
  const deps = {
    complete: async () => {
      completions++;
      if (completions === 1) return '{"action":{"tool":"file.readRange","input":{"rootPath":"/ws","path":"a.ts","startLine":1,"endLine":2}}}';
      return completions === 2
        ? '{"final":"Continuing setup."}'
        : '{"final":"Inspected the workspace, ran npm install (ok), proposed src/index.js; no tests present yet."}';
    },
    executeTool: async () => ({}),
    tools: TOOLS,
  };
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.equal(completions, 3, 'one tool step, then exactly one corrective retry');
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Inspected the workspace/);
});

test('command-created files are reported and count as progress', async () => {
  const { deps } = harness(
    ['{"action":{"tool":"command.run","input":{"command":["npm","init","-y"]}}}', '{"final":"Ran npm init; package.json created. Proposed nothing further; done."}'],
    { results: () => ({ tool: 'command.run', exitCode: 0 }), listFiles: () => [['README.md'], ['README.md', 'package.json']] },
  );
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  const effect = events.find((e) => e.type === 'note' && e.kind === 'command-effect') as { message: string } | undefined;
  assert.ok(effect, 'a command-effect note must be emitted');
  assert.match(effect!.message, /package\.json/);
});

test('when proposals were emitted, the final carries a machine truth footer (not applied)', async () => {
  const { deps } = harness(
    ['{"action":{"tool":"edit.preview","input":{"changes":[{"path":"a.ts","startLine":1,"endLine":1,"replacement":"x"}]}}}', '{"final":"I applied the change successfully and everything now works as intended here."}'],
    { results: () => ({ tool: 'edit.preview', files: [{ path: 'a.ts', before: '', after: 'x' }] }) },
  );
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /NOT applied — the engineer runs preview-only/);
});

test('with no proposals, no footer is appended', async () => {
  const { deps } = harness([
    '{"action":{"tool":"workspace.search","input":{"query":"x"}}}',
    '{"final":"Searched the workspace; found nothing relevant and proposed no changes at all here."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.doesNotMatch(final.markdown, /preview-only/);
});

test('external-effect command (npm publish) is refused in-loop, not executed', async () => {
  const { deps, calls } = harness([
    '{"action":{"tool":"command.run","input":{"command":["npm","publish"]}}}',
    '{"final":"Publish was refused by policy; nothing published. Done."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/ws', task: 't' }));
  assert.equal(calls.length, 0, 'a denied command must never execute');
  assert.ok(events.some((e) => e.type === 'note' && e.kind === 'policy'));
});
