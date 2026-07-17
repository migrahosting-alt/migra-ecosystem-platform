// Slice 2 — workspace-agent capability routing: command.run policy + the
// model-in-the-loop engineer runtime. All model calls are scripted fakes; the
// tool boundary and filesystem effects are REAL.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { commandRun, commandAllowlist, commandRunEnabled } from '../src/tools/commandRun.js';
import { runEngineerTask, parseStep, type EngineerEvent, type EngineerToolInfo } from '../src/engine/engineerRuntime.js';
import { CapabilityRegistry } from '../src/engine/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/toolAudit.js';
import { executeToolCore } from '../src/engine/toolExecutor.js';

function ws(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'migra-engineer-'));
  writeFileSync(path.join(root, 'hello.js'), 'console.log("hi from ws");\n');
  return root;
}

// ── command.run policy ─────────────────────────────────────────────────────────

test('command.run executes an allowlisted argv command in the workspace', async () => {
  const root = ws();
  const res = await commandRun({ rootPath: root, command: ['node', 'hello.js'] }, {});
  assert.equal(res.exitCode, 0);
  assert.match(res.stdout, /hi from ws/);
  assert.equal(res.timedOut, false);
});

test('command.run refuses non-allowlisted programs outright (no approval fallback)', async () => {
  const root = ws();
  await assert.rejects(() => commandRun({ rootPath: root, command: ['bash', '-c', 'echo x'] }, {}), /not on the allowlist/);
  await assert.rejects(() => commandRun({ rootPath: root, command: ['rm', '-x'] }, {}), /not on the allowlist/);
});

test('command.run refuses pathed argv0 (no allowlist bypass via paths)', async () => {
  const root = ws();
  await assert.rejects(() => commandRun({ rootPath: root, command: ['/usr/bin/node', 'hello.js'] }, {}), /bare program name/);
  await assert.rejects(() => commandRun({ rootPath: root, command: ['../node', 'hello.js'] }, {}), /bare program name/);
});

test('command.run cwd is contained: absolute, traversal, and symlink escapes refused', async () => {
  const root = ws();
  mkdirSync(path.join(root, 'sub'));
  symlinkSync(tmpdir(), path.join(root, 'esc'));
  await assert.rejects(() => commandRun({ rootPath: root, command: ['node', '-v'], cwd: '/tmp' }, {}), /relative/);
  await assert.rejects(() => commandRun({ rootPath: root, command: ['node', '-v'], cwd: '../..' }, {}), /escapes/);
  await assert.rejects(() => commandRun({ rootPath: root, command: ['node', '-v'], cwd: 'esc' }, {}), /escapes/);
  const ok = await commandRun({ rootPath: root, command: ['node', '-v'], cwd: 'sub' }, {});
  assert.equal(ok.exitCode, 0);
});

test('command.run kill-switch + allowlist env are honored', async () => {
  const root = ws();
  await assert.rejects(
    () => commandRun({ rootPath: root, command: ['node', '-v'] }, { MIGRAPILOT_COMMAND_RUN: 'off' }),
    /disabled/,
  );
  assert.deepEqual(commandAllowlist({ MIGRAPILOT_COMMAND_ALLOWLIST: 'node, tsc' }), ['node', 'tsc']);
  assert.equal(commandRunEnabled({ MIGRAPILOT_COMMAND_RUN: 'off' }), false);
  await assert.rejects(
    () => commandRun({ rootPath: root, command: ['npm', '-v'] }, { MIGRAPILOT_COMMAND_ALLOWLIST: 'node' }),
    /not on the allowlist/,
  );
});

test('command.run caps runaway output and reports truncation + nonzero exit', async () => {
  const root = ws();
  // Write once and exit only after the pipe flushes — avoids losing output on exit.
  writeFileSync(path.join(root, 'noisy.js'), 'process.stdout.write("x".repeat(100000), () => process.exit(3));');
  const res = await commandRun({ rootPath: root, command: ['node', 'noisy.js'] }, {});
  assert.equal(res.exitCode, 3);
  assert.equal(res.truncated, true);
  assert.ok(res.stdout.length <= 24 * 1024);
});

test('command.run times out hung commands', async () => {
  const root = ws();
  writeFileSync(path.join(root, 'hang.js'), 'setInterval(() => {}, 1000);');
  const res = await commandRun({ rootPath: root, command: ['node', 'hang.js'], timeoutMs: 500 }, {});
  assert.equal(res.timedOut, true);
});

test('command.run is registered available; terminal.exec stays denied', () => {
  const registry = new CapabilityRegistry();
  const cmd = registry.get('command.run');
  assert.ok(cmd && cmd.available, 'command.run must be granted');
  const term = registry.get('terminal.exec');
  assert.ok(term && !term.available, 'terminal.exec must stay ungranted');
});

test('executor honors approvalRequired:false — command.run executes immediately; edit.apply still parks', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const ran = await executeToolCore(deps, { tool: 'command.run', input: { rootPath: root, command: ['node', 'hello.js'] }, requestId: 'r1' });
  assert.ok(ran.ok, 'command.run must not park for approval');
  assert.equal(ran.ok && ran.status, 'executed');
  assert.match(String((ran.ok && (ran.result as { stdout: string }).stdout) ?? ''), /hi from ws/);

  const parked = await executeToolCore(deps, {
    tool: 'edit.apply',
    input: { rootPath: root, changes: [{ path: 'hello.js', startLine: 1, endLine: 1, replacement: '// x' }] },
    requestId: 'r2',
  });
  assert.ok(parked.ok && parked.status === 'approval_required', 'edit.apply must STILL require approval');
});

// ── engineer runtime (scripted model, real semantics) ──────────────────────────

const TOOLS: EngineerToolInfo[] = [
  { id: 'file.readRange', description: 'read', readOnly: true, inputHint: '{}' },
  { id: 'edit.preview', description: 'preview', readOnly: true, inputHint: '{}' },
  { id: 'command.run', description: 'run', readOnly: false, inputHint: '{}' },
];

function scriptedDeps(replies: string[]) {
  const calls: Array<{ tool: string; input: unknown }> = [];
  let i = 0;
  return {
    deps: {
      complete: async () => replies[Math.min(i++, replies.length - 1)]!,
      executeTool: async (tool: string, input: unknown) => {
        calls.push({ tool, input });
        if (tool === 'edit.preview') return { tool, files: [{ path: 'a.ts', before: 'x', after: 'y' }] };
        return { tool, ok: true };
      },
      tools: TOOLS,
    },
    calls,
  };
}

async function drain(gen: AsyncGenerator<EngineerEvent>): Promise<EngineerEvent[]> {
  const out: EngineerEvent[] = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

test('parseStep tolerates fences and rejects junk', () => {
  assert.equal(parseStep('{"final":"done"}').kind, 'final');
  assert.equal(parseStep('```json\n{"action":{"tool":"x","input":{}}}\n```').kind, 'action');
  assert.equal(parseStep('I will now inspect the file').kind, 'malformed');
  assert.equal(parseStep('{"other":1}').kind, 'malformed');
});

test('happy path: read tool then final answer; server-authoritative rootPath', async () => {
  const { deps, calls } = scriptedDeps([
    '{"action":{"tool":"file.readRange","input":{"rootPath":"/model-lies","path":"a.ts","startLine":1,"endLine":5}}}',
    '{"final":"All good."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/real-root', task: 'inspect a.ts' }));
  assert.deepEqual(events.map((e) => e.type), ['step', 'final']);
  assert.equal((calls[0]!.input as { rootPath: string }).rootPath, '/real-root', 'model-supplied root must be overridden');
  assert.equal((events[1] as { markdown: string }).markdown, 'All good.');
});

test('edit.apply is NEVER executed: substituted with edit.preview and surfaced as a proposal', async () => {
  const { deps, calls } = scriptedDeps([
    '{"action":{"tool":"edit.apply","input":{"changes":[{"path":"a.ts","startLine":1,"endLine":1,"replacement":"y"}]}}}',
    '{"final":"Proposed the change."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/r', task: 'fix a.ts' }));
  assert.deepEqual(events.map((e) => e.type), ['step', 'proposal', 'final']);
  assert.equal(calls[0]!.tool, 'edit.preview', 'edit.apply must be rewritten to preview');
  assert.ok(calls.every((c) => c.tool !== 'edit.apply'));
});

test('malformed output gets exactly one retry, then an honest machine error', async () => {
  const { deps } = scriptedDeps(['prose, not JSON', 'still prose']);
  const events = await drain(runEngineerTask(deps, { rootPath: '/r', task: 't' }));
  assert.equal(events.length, 1);
  assert.equal(events[0]!.type, 'error');
  assert.equal((events[0] as { code: string }).code, 'MALFORMED_MODEL_OUTPUT');
});

test('unknown tool becomes corrective feedback, and the step cap ends the loop honestly', async () => {
  const { deps, calls } = scriptedDeps(['{"action":{"tool":"nope.tool","input":{}}}']);
  const events = await drain(runEngineerTask({ ...deps, maxSteps: 3 }, { rootPath: '/r', task: 't' }));
  assert.equal(calls.length, 0, 'unknown tool must not execute anything');
  assert.equal(events.at(-1)!.type, 'error');
  assert.equal((events.at(-1) as { code: string }).code, 'STEP_LIMIT');
});

test('tool failure is feedback, not fatal: the model can adapt and finish', async () => {
  let failed = false;
  const deps = {
    complete: async (prompt: string) =>
      prompt.includes('FAILED') ? '{"final":"Build failed as expected; reported."}' : '{"action":{"tool":"command.run","input":{"command":["npm","test"]}}}',
    executeTool: async () => {
      failed = true;
      throw new Error('POLICY: not on the allowlist');
    },
    tools: TOOLS,
  };
  const events = await drain(runEngineerTask(deps, { rootPath: '/r', task: 'run tests' }));
  assert.equal(failed, true);
  assert.equal(events.at(-1)!.type, 'final');
});

test('ecosystem flag injects the ecosystem context block; absent otherwise', async () => {
  const prompts: string[] = [];
  const deps = {
    complete: async (p: string) => {
      prompts.push(p);
      // A substantive final so weak-final enforcement doesn't add a retry.
      return '{"final":"Inspected the workspace; nothing to change. No commands run; no files proposed."}';
    },
    executeTool: async () => ({}),
    tools: TOOLS,
  };
  await drain(runEngineerTask(deps, { rootPath: '/r', task: 't', ecosystem: true }));
  await drain(runEngineerTask(deps, { rootPath: '/r', task: 't' }));
  assert.match(prompts[0]!, /ECOSYSTEM CONTEXT/);
  assert.doesNotMatch(prompts[1]!, /ECOSYSTEM CONTEXT/);
});
