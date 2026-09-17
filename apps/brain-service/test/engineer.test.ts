// Slice 2 — workspace-agent capability routing: command.run policy + the
// model-in-the-loop engineer runtime. All model calls are scripted fakes; the
// tool boundary and filesystem effects are REAL.

import { buildEngineerLoopTools } from '../src/engine/engineer/engineerToolCatalog.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileRead, fileReadRange, workspaceList, workspaceFind, gitStatus } from '@migrapilot/workspace-tools';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { commandRun, commandAllowlist, commandRunEnabled, previewCommandRun } from '../src/tools/commandRun.js';
import {
  restoreCompletionEvidence,
  missingCompletionObligations, runEngineerTask, parseStep, requiresRepositoryMapEvidence, createCompletionEvidenceState, observeCompletionEvidence, type EngineerDeps, type EngineerEvent, type EngineerToolInfo } from '../src/engine/engineer/engineerRuntime.js';
import { CapabilityRegistry } from '../src/engine/models/capabilityRegistry.js';
import { ToolApprovalStore } from '../src/engine/tools/toolApprovalStore.js';
import { ToolAudit } from '../src/engine/tools/toolAudit.js';
import { executeToolCore } from '../src/engine/tools/toolExecutor.js';

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

test('command.run refuses environment overrides that can substitute the previewed executable', async () => {
  const root = ws();
  await assert.rejects(
    () => commandRun({ rootPath: root, command: ['node', '-e', 'process.exit(0)'], environment: { PATH: root } }),
    /alter executable resolution/,
  );
  await assert.rejects(
    () => previewCommandRun({ rootPath: root, command: ['node', '-e', 'process.exit(0)'], environment: { LD_PRELOAD: './payload.so' } }),
    /alter executable resolution/,
  );
});

test('legacy command output scrubs every supplied environment value and preview redacts all keys', async () => {
  const root = ws();
  const secret = 'line one\nline/two?x=1';
  const preview = await previewCommandRun({ rootPath: root, command: ['node', '--version'], environment: { api_token: secret, harmless_name: 'innocent-secret' } });
  assert.ok(preview.environment.every((entry) => entry.value === '[REDACTED]' && entry.redacted));
  const code = 'const s=process.env.api_token;console.log(s);console.error(encodeURIComponent(s));console.log(Buffer.from(process.env.harmless_name).toString("base64"))';
  const result = await commandRun({ rootPath: root, command: ['node', '-e', code], environment: { api_token: secret, harmless_name: 'innocent-secret' } }, {});
  assert.equal(result.redacted, true);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /line one|line%20one|aW5ub2NlbnQtc2VjcmV0|innocent-secret/);
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

test('arbitrary command.run is absent from the generic registry; terminal.exec stays denied', () => {
  const registry = new CapabilityRegistry();
  const cmd = registry.get('command.run');
  assert.equal(cmd, undefined, 'command.run must not be exposed by generic tools');
  const term = registry.get('terminal.exec');
  assert.ok(term && !term.available, 'terminal.exec must stay ungranted');
});

test('generic executor denies command.run while edit.apply still requires approval', async () => {
  const deps = { registry: new CapabilityRegistry(), approvals: new ToolApprovalStore(), audit: new ToolAudit() };
  const root = ws();
  const denied = await executeToolCore(deps, { tool: 'command.run', input: { rootPath: root, command: ['node', 'hello.js'] }, requestId: 'r1' });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.code, 'UNKNOWN_TOOL');
  assert.equal(deps.audit.recent().some((event) => event.action === 'approval_required'), false, 'generic command denial must mint no approval');
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

const CA2_TOOLS: EngineerToolInfo[] =
  buildEngineerLoopTools(new CapabilityRegistry());

function scriptedDeps(
  replies: string[],
  tools: EngineerToolInfo[] = TOOLS,
) {
  const calls: Array<{ tool: string; input: unknown }> = [];
  let i = 0;
  return {
    deps: {
      complete: async () => replies[Math.min(i++, replies.length - 1)]!,
      executeTool: async (tool: string, input: unknown): Promise<unknown> => {
        calls.push({ tool, input });
        if (tool === 'edit.preview') return { tool, files: [{ path: 'a.ts', before: 'x', after: 'y' }] };
        return { tool, ok: true };
      },
      tools,
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

// Regression: qwen3-coder:30b emits NATIVE XML tool calls instead of the JSON
// protocol (the same behaviour that broke /deep). The engineer must accept it
// rather than killing the run with MALFORMED_MODEL_OUTPUT.
test('parseStep accepts a Qwen/Hermes XML tool call as a fallback', () => {
  const s = parseStep('<function=file.readRange>\n<parameter=path>src/a.ts</parameter>\n<parameter=startLine>1</parameter>\n<parameter=endLine>20</parameter>\n</function>');
  assert.equal(s.kind, 'action');
  assert.equal(s.kind === 'action' && s.tool, 'file.readRange');
  assert.deepEqual(s.kind === 'action' && s.input, { path: 'src/a.ts', startLine: 1, endLine: 20 });

  // JSON-valued parameters (e.g. a changeset ops array) are parsed, not stringified.
  const cs = parseStep('<function=fs.proposeChangeset><parameter=ops>[{"op":"create","path":"a.js","content":"x"}]</parameter></function>');
  assert.deepEqual(
    cs.kind === 'action' && cs.input,
    { ops: [{ op: 'create', path: 'a.js', content: 'x' }] },
  );

  // JSON args directly inside the tag also work.
  assert.deepEqual(
    (() => { const r = parseStep('<function=git.status>{"rootPath":"/w"}</function>'); return r.kind === 'action' && r.input; })(),
    { rootPath: '/w' },
  );

  // Real JSON still wins, and genuine prose is still malformed.
  assert.equal(parseStep('{"final":"done"}').kind, 'final');
  assert.equal(parseStep('I will now inspect the file').kind, 'malformed');
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

test('a recorded proposal is never reported as a failure ("create files manually")', async () => {
  // The model proposes a change, then WRONGLY declares failure and tells the user
  // to create the files by hand — twice. The loop corrects once, then overrides
  // deterministically so the user never sees a false failure for a real proposal.
  const { deps } = scriptedDeps([
    '{"action":{"tool":"edit.preview","input":{"changes":[{"path":"a.ts","startLine":1,"endLine":1,"replacement":"y"}]}}}',
    '{"final":"Failed to create files using edit.preview. Please manually create the following files: a.ts."}',
    '{"final":"I was unable to create the file. Create it manually yourself."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/r', task: 'build a.ts' }));
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.ok(final, 'a final is emitted');
  assert.doesNotMatch(final.markdown, /manually|failed to create|unable to create/i, 'no false-failure language');
  assert.match(final.markdown, /approve to apply/i, 'presents the proposal as approvable');
});

test('a recorded proposal + honest final passes through with the preview-only footer', async () => {
  const { deps } = scriptedDeps([
    '{"action":{"tool":"edit.preview","input":{"changes":[{"path":"a.ts","startLine":1,"endLine":1,"replacement":"y"}]}}}',
    '{"final":"Proposed an edit to a.ts that renames the handler. Review and approve to apply."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/r', task: 'edit a.ts' }));
  const final = events.find((e) => e.type === 'final') as { markdown: string };
  assert.match(final.markdown, /Proposed an edit to a\.ts/);
  assert.match(final.markdown, /NOT applied/i, 'preview-only footer appended');
});

test('a defective proposal (duplicate def) triggers a quality note + self-correction', async () => {
  const replies = [
    // 1) botched proposal — a.js defines f() twice (classic sloppy edit)
    '{"action":{"tool":"fs.proposeChangeset","input":{"ops":[{"op":"create","path":"a.js","content":"function f(){return 1;}\\nfunction f(){return 2;}\\n"}]}}}',
    // 2) after the fed-back defect, the model re-proposes a clean file
    '{"action":{"tool":"fs.proposeChangeset","input":{"ops":[{"op":"create","path":"a.js","content":"function f(){return 2;}\\n"}]}}}',
    '{"final":"Proposed a.js."}',
  ];
  let i = 0;
  const deps = {
    complete: async () => replies[Math.min(i++, replies.length - 1)]!,
    executeTool: async (tool: string, input: unknown) => ({ tool, input, ok: true }),
    tools: [{ id: 'fs.proposeChangeset', description: 'propose', readOnly: false, inputHint: '{}' }] as EngineerToolInfo[],
  };
  const events = await drain(runEngineerTask(deps, { rootPath: '/w', task: 'build a.js' }));
  const qNote = events.find((e) => e.type === 'note' && (e as { kind?: string }).kind === 'quality') as { message: string } | undefined;
  assert.ok(qNote, 'a quality note is emitted for the defective proposal');
  assert.match(qNote.message, /defines 'f'/);
  // the loop kept going (re-proposed) rather than accepting the botch as final
  assert.ok(events.some((e) => e.type === 'final'), 'still reaches a final after correcting');
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


// ── ENGINEER COMPLETION AUTHORITY 1 ──────────────────────────────────────────

test('unfinished persistent plan rejects "next I would" final until every feasible step is complete', async () => {
  const replies = [
    // Establish controller-persistent work.
    '{"action":{"tool":"plan.update","input":{"steps":["inspect manifest","inspect source","inspect tests"]}}}',

    // Do + complete step 1.
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":20}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',

    // The measured production defect: model honestly admits work remains but
    // nevertheless asks the runtime to terminate.
    '{"final":"I inspected the manifest. Next I would inspect src and tests."}',

    // Controller must reject that final and keep executing.
    '{"action":{"tool":"file.readRange","input":{"path":"src/index.ts","startLine":1,"endLine":20}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[2]}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"tests/index.test.ts","startLine":1,"endLine":20}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[3]}}}',

    '{"final":"Repository inspection is complete: manifest, source, and tests were inspected."}',
  ];

  const { deps, calls } = scriptedDeps(replies);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 14 },
      { rootPath: '/r', task: 'inspect manifest, source, and tests' },
    ),
  );

  const finals = events.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1, 'premature final must not escape the completion authority');
  assert.match(
    (finals[0] as { markdown: string }).markdown,
    /inspection is complete/i,
  );

  assert.equal(
    calls.filter((c) => c.tool === 'file.readRange').length,
    3,
    'all three evidence-gathering reads must execute before terminal final',
  );

  const planNotes = events
    .filter((e) => e.type === 'note' && (e as { kind?: string }).kind === 'plan')
    .map((e) => (e as { message: string }).message);

  assert.ok(planNotes.some((m) => /PLAN \(3\/3 done\)/.test(m)), 'plan reaches 3/3 before final');
});

test('unfinished plan + WORKSPACE_FACT declaration continues to inspection', async () => {
  const replies = [
    '{"action":{"tool":"plan.update","input":{"steps":["inspect package manifest"]}}}',
    JSON.stringify({
      final: 'I still need to determine which framework this repository uses.',
      missing: {
        kind: 'WORKSPACE_FACT',
        subject: 'framework used by this repository',
        evidence: 'the package manifest has not been inspected yet',
      },
    }),
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":30}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    '{"final":"The manifest has now been inspected."}',
  ];

  const { deps, calls } = scriptedDeps(replies);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 10, workspaceExists: () => true },
      {
        rootPath: '/r',
        task: 'determine which framework this repository uses',
        intent: 'INSPECT',
      },
    ),
  );

  const decisions = events.filter((e) => e.type === 'decision') as Array<{
    type: 'decision';
    disposition: string;
    toolAuthority: string;
  }>;

  assert.ok(
    decisions.some((d) => d.disposition === 'CONTINUE_TO_INSPECT'),
    'WORKSPACE_FACT must remain inside the tool loop',
  );

  assert.equal(calls.filter((c) => c.tool === 'file.readRange').length, 1);
  assert.equal(events.filter((e) => e.type === 'final').length, 1);
});

test('unfinished plan does not suppress a verified USER_PREFERENCE terminal question', async () => {
  const replies = [
    '{"action":{"tool":"plan.update","input":{"steps":["choose deployment target","implement target config"]}}}',
    JSON.stringify({
      final: 'Which deployment target do you want me to use: staging or production?',
      missing: {
        kind: 'USER_PREFERENCE',
        subject: 'deployment target',
        evidence: 'the requested target is a product choice that is not encoded in the workspace',
      },
    }),
  ];

  const { deps } = scriptedDeps(replies);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 6 },
      {
        rootPath: '/r',
        task: 'configure the deployment target',
        intent: 'BUILD',
      },
    ),
  );

  const decision = events.find((e) => e.type === 'decision') as
    | { disposition: string; missingInformationKind: string }
    | undefined;

  assert.ok(decision, 'controller decision is emitted');
  assert.equal(decision.missingInformationKind, 'USER_PREFERENCE');
  assert.equal(decision.disposition, 'NEEDS_USER_INPUT');

  const final = events.find((e) => e.type === 'final') as { markdown: string } | undefined;
  assert.ok(final, 'verified user preference may terminate for user input');
  assert.match(final.markdown, /staging or production/i);
});

test('repeated ordinary finals against the same unfinished plan stop honestly with LOOP_NO_PROGRESS', async () => {
  const replies = [
    '{"action":{"tool":"plan.update","input":{"steps":["inspect source"]}}}',
    '{"final":"Next I would inspect the source."}',
    '{"final":"More commands should be run before this is complete."}',
    '{"final":"I still need to inspect the source."}',
  ];

  const { deps } = scriptedDeps(replies);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 10 },
      { rootPath: '/r', task: 'inspect the source tree' },
    ),
  );

  assert.equal(events.some((e) => e.type === 'final'), false);

  const error = events.find((e) => e.type === 'error') as
    | { code: string; message: string }
    | undefined;

  assert.ok(error);
  assert.equal(error.code, 'LOOP_NO_PROGRESS');
  assert.match(error.message, /plan steps.*unchecked|unchecked.*plan steps/i);
});



// ── ENGINEER COMPLETION AUTHORITY 2 ─────────────────────────────────────────

test('repository map refuses final after only root listing and git state', async () => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":0}}}',
    '{"action":{"tool":"git.status","input":{}}}',
    '{"final":"Repository map complete."}',
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":80}}}',
    '{"final":"Still complete."}',
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 5 },
      {
        rootPath: '/r',
        task:
          'Map this repository. Identify the repository root, top-level directories, package/build manifests, application entrypoints, test locations, deployment/runtime configuration, and current Git state.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(
    events.some((e) => e.type === 'final'),
    false,
    'root listing + git state must not satisfy the repository-map evidence contract',
  );
});

test('repository map requires package.json contents, not merely seeing package.json in a listing', async () => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":1}}}',
    '{"action":{"tool":"git.status","input":{}}}',
    '{"final":"package.json exists, so the manifest is covered."}',
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 3 },
      {
        rootPath: '/r',
        task: 'Create a repository map including manifests, entrypoints, tests, deployment/runtime configuration, and Git state.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(events.some((e) => e.type === 'final'), false);
});

test('repository map requires source and tests inspection', async () => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":0}}}',
    '{"action":{"tool":"git.status","input":{}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":80}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"next.config.ts","startLine":1,"endLine":80}}}',
    '{"final":"Repository map complete; src and tests are present."}',
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 5 },
      {
        rootPath: '/r',
        task: 'Map this repository including source, entrypoints, tests, deployment/runtime configuration, and Git state.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(events.some((e) => e.type === 'final'), false);
});

test('next.config.ts cannot satisfy application entrypoint evidence', async () => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":0}}}',
    '{"action":{"tool":"git.status","input":{}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":80}}}',
    '{"action":{"tool":"workspace.list","input":{"path":"src","depth":1}}}',
    '{"action":{"tool":"workspace.list","input":{"path":"tests","depth":1}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"next.config.ts","startLine":1,"endLine":80}}}',
    '{"final":"next.config.ts is the application entrypoint."}',
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 7 },
      {
        rootPath: '/r',
        task: 'Map this repository including root, top-level directories, manifests, application entrypoints, tests, runtime configuration, and Git state.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(
    events.some((e) => e.type === 'final'),
    false,
    'configuration alone must never satisfy repo.entrypoint',
  );
});

test('all repository-map evidence obligations permit final from real filesystem reads', async (t) => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":0}}}',
    '{"action":{"tool":"git.status","input":{}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"package.json","startLine":1,"endLine":100}}}',
    '{"action":{"tool":"workspace.list","input":{"path":"src","depth":1}}}',
    '{"action":{"tool":"file.read","input":{"path":"src/app/page.ts"}}}',
    '{"action":{"tool":"workspace.list","input":{"path":"tests","depth":1}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"next.config.ts","startLine":1,"endLine":100}}}',
    '{"final":"Repository map is complete from inspected manifest, source entry surface, tests, runtime configuration, and Git state."}',
  ];

  const root = repositoryFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const { deps, calls } = scriptedDeps(replies, CA2_TOOLS);
  deps.executeTool = async (tool: string, input: unknown): Promise<unknown> => {
    calls.push({ tool, input });
    if (tool === 'workspace.list') return workspaceList(input as never);
    if (tool === 'file.read') return fileRead(input as never);
    if (tool === 'file.readRange') return fileReadRange(input as never);
    if (tool === 'git.status') return gitStatus(input as never);
    throw new Error(`Unexpected tool ${tool}`);
  };
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 10 },
      {
        rootPath: root,
        task:
          'Map this repository before doing anything else. Identify the repository root, top-level directories, package/build manifests, application entrypoints, test locations, deployment/runtime configuration, and current Git state. Do not modify anything. Support the map with file paths.',
        intent: 'INSPECT',
      },
    ),
  );

  const finals = events.filter((e) => e.type === 'final');
  assert.equal(finals.length, 1);
  assert.equal(calls.some((c) => c.tool === 'file.readRange'), true);
  assert.equal(calls.some((c) => c.tool === 'workspace.list'), true);
  assert.equal(calls.some((c) => c.tool === 'git.status'), true);
});

test('repository-map CA2 still allows a verified USER_PREFERENCE terminal dependency', async () => {
  const replies = [
    JSON.stringify({
      final: 'Which deployment target do you want me to evaluate?',
      missing: {
        kind: 'USER_PREFERENCE',
        subject: 'deployment target',
        evidence: 'the user must choose which target they want evaluated',
      },
    }),
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 3, workspaceExists: () => true },
      {
        rootPath: '/r',
        task: 'Map this repository and evaluate deployment/runtime configuration after I choose the deployment target.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(
    events.some((e) => e.type === 'final'),
    true,
    'a genuine user-only dependency remains a legitimate terminal state',
  );
});

test('repository-map malformed prose cannot bypass CA2 evidence gate', async () => {
  const replies = [
    '{"action":{"tool":"workspace.list","input":{"path":"","depth":0}}}',
    'Repository map complete. package.json exists and next.config.ts is the entrypoint.',
  ];

  const { deps } = scriptedDeps(replies, CA2_TOOLS);
  const events = await drain(
    runEngineerTask(
      { ...deps, maxSteps: 2 },
      {
        rootPath: '/r',
        task: 'Map this repository including manifests, entrypoints, tests, deployment/runtime configuration, and Git state.',
        intent: 'INSPECT',
      },
    ),
  );

  assert.equal(
    events.some((e) => e.type === 'final'),
    false,
    'prose salvage must not bypass deterministic evidence obligations',
  );
});

test('CA2 evidence comes from the canonical production capability registry', () => {
  const tools = buildEngineerLoopTools(new CapabilityRegistry());
  const byId = new Map(tools.map((t) => [t.id, t]));

  assert.deepEqual(
    byId.get('workspace.list')?.evidenceSemantics,
    ['workspace.directory_listing'],
  );

  assert.deepEqual(
    byId.get('workspace.find')?.evidenceSemantics,
    ['workspace.path_discovery'],
  );

  assert.deepEqual(
    byId.get('workspace.search')?.evidenceSemantics,
    ['workspace.content_search'],
  );

  for (const id of ['file.read', 'file.readRange', 'file.readSymbol']) {
    assert.deepEqual(
      byId.get(id)?.evidenceSemantics,
      ['workspace.file_content'],
      `${id} must expose canonical file-content evidence`,
    );
  }

  for (const id of ['git.status', 'git.overview']) {
    assert.deepEqual(
      byId.get(id)?.evidenceSemantics,
      ['vcs.state'],
      `${id} must expose canonical VCS-state evidence`,
    );
  }

  assert.deepEqual(
    byId.get('git.diff')?.evidenceSemantics,
    ['vcs.diff'],
  );

  assert.deepEqual(
    byId.get('diagnostics.get')?.evidenceSemantics,
    ['workspace.diagnostics'],
  );

  assert.deepEqual(
    byId.get('plan.update')?.evidenceSemantics,
    [],
    'model-owned planning must never count as repository evidence',
  );
});

test('generic repository audit does not activate the repository-map contract', () => {
  assert.equal(
    requiresRepositoryMapEvidence({
      rootPath: '/r',
      task: 'audit this repository',
      intent: 'INSPECT',
    }),
    false,
  );
});

test('explicit repository map activates the repository-map contract', () => {
  assert.equal(
    requiresRepositoryMapEvidence({
      rootPath: '/r',
      task: 'Map this repository and show its structure.',
      intent: 'INSPECT',
    }),
    true,
  );
});

test('specific repository-map requirements activate without the word map', () => {
  assert.equal(
    requiresRepositoryMapEvidence({
      rootPath: '/r',
      task:
        'Inspect this repository and identify its top-level directories, package manifest, application entrypoint, tests, deployment configuration, and current Git state.',
      intent: 'INSPECT',
    }),
    true,
  );
});

// Authoritative final delivery, including streaming providers.
function streamed(replies: string[]): EngineerDeps {
  let index = 0;
  return {
    complete: async () => { throw new Error('streaming provider must be used'); },
    completeStream: async function* () {
      const reply = replies[index++];
      assert.ok(reply, 'unexpected extra generation');
      for (const char of reply) yield char;
    },
    executeTool: async () => ({ ok: true }),
    tools: buildEngineerLoopTools(new CapabilityRegistry()),
    maxSteps: 12,
  };
}

async function collect(deps: EngineerDeps, task: string): Promise<EngineerEvent[]> {
  const events: EngineerEvent[] = [];
  for await (const event of runEngineerTask(deps, { rootPath: '/workspace', task })) {
    assert.notEqual(event.type, 'token', 'provisional model text must never escape the controller');
    events.push(event);
  }
  return events;
}

test('streamed premature final stays private while unfinished plan continues', async () => {
  const events = await collect(streamed([
    '{"action":{"tool":"plan.update","input":{"steps":["read source"]}}}',
    '{"final":"Next I would read the source."}',
    '{"action":{"tool":"file.readRange","input":{"path":"src/index.ts","startLine":1,"endLine":5}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    '{"final":"The source was inspected; no changes were proposed."}',
  ]), 'Inspect the source');
  const finals = events.filter(e => e.type === 'final');
  assert.equal(finals.length, 1);
  assert.match(finals[0]!.markdown, /source was inspected/);
  assert.ok(events.some(e => e.type === 'step' && e.tool === 'file.readRange'));
});

test('repository-map evidence rejection never publishes attempted streamed finals', async () => {
  const deps = streamed(Array(5).fill('{"final":"Repository map complete."}'));
  const events = await collect(deps, 'Create a repository map');
  assert.equal(events.some(e => e.type === 'final'), false);
  assert.ok(events.some(e => e.type === 'error' && e.code === 'LOOP_NO_PROGRESS'));
});

test('malformed streamed final is discarded before a corrected answer is accepted', async () => {
  const events = await collect(streamed([
    '{"final":"This incomplete answer must stay private',
    '{"final":"A function maps its inputs to an output."}',
  ]), 'What is a function?');
  assert.deepEqual(events.filter(e => e.type === 'final').map(e => e.markdown), [
    'A function maps its inputs to an output.',
  ]);
});

test('interrupted provider stream publishes no partial answer', async () => {
  const deps = streamed([]);
  deps.completeStream = async function* () {
    yield '{"final":"I finished everything';
    throw new Error('provider disconnected');
  };
  await assert.rejects(collect(deps, 'Explain this code'), /provider disconnected/);
});


function repositoryFixture(): string {
  const root = ws();
  mkdirSync(path.join(root, 'src/app'), { recursive: true });
  mkdirSync(path.join(root, 'tests'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture', scripts: { test: 'node --test', start: 'node src/index.js' },
    dependencies: { next: '1.0.0' },
  }, null, 2));
  writeFileSync(path.join(root, 'src/app/page.ts'), 'export default function Page() { return "hello"; }');
  writeFileSync(path.join(root, 'tests/page.test.ts'), 'import assert from "node:assert/strict"; assert.ok(true);');
  writeFileSync(path.join(root, 'next.config.ts'), 'export default {};');
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  return root;
}

test('manifest obligations require actual complete contents, including scripts for runtime', async (t) => {
  const root = repositoryFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tool = (id: string) => CA2_TOOLS.find(t => t.id === id)!;
  const state = createCompletionEvidenceState({ rootPath: root, task: 'Map this repository' });
  const input = { rootPath: root, path: 'package.json' };
  const observe = (id: string, result: unknown) => observeCompletionEvidence(state, tool(id), input, result);

  assert.equal(observe('file.read', { ok: true }), 0, 'dispatch success is not read evidence');
  assert.equal(observe('file.read', await fileRead({ ...input, maxBytes: 5 })), 0, 'truncation is not a complete manifest');
  assert.equal(observe('file.readRange', await fileReadRange({ ...input, startLine: 1, endLine: 2 })), 0);
  assert.equal(observe('file.read', { ...(await fileRead(input)), path: 'different.json' }), 0, 'wrong file cannot satisfy requested read');
  writeFileSync(path.join(root, input.path), '');
  assert.equal(observe('file.read', await fileRead(input)), 0, 'empty file is not framework evidence');
  writeFileSync(path.join(root, input.path), '{broken');
  assert.equal(observe('file.read', await fileRead(input)), 0, 'invalid JSON cannot establish manifest facts');
  writeFileSync(path.join(root, input.path), '{"name":"library","dependencies":{}}');
  observe('file.read', await fileRead(input));
  assert.ok(state.satisfied.has('repo.manifest_contents'));
  assert.ok(state.satisfied.has('repo.framework_runtime'));
  assert.equal(state.satisfied.has('repo.deployment_runtime'), false, 'scriptless manifest has no runtime command evidence');
  writeFileSync(path.join(root, input.path), '{"scripts":{"start":"node main.js"}}');
  observe('file.readRange', await fileReadRange({ ...input, startLine: 1, endLine: 100 }));
  assert.ok(state.satisfied.has('repo.deployment_runtime'));
});

test('entrypoint obligation requires source contents rather than a real directory listing', async (t) => {
  const root = repositoryFixture();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = createCompletionEvidenceState({ rootPath: root, task: 'Map this repository' });
  const input = { rootPath: root, path: 'src/app' };
  observeCompletionEvidence(state, CA2_TOOLS.find(t => t.id === 'workspace.list'), input, await workspaceList(input));
  assert.ok(state.satisfied.has('repo.source_tree'));
  assert.equal(state.satisfied.has('repo.entrypoint'), false);
  const entry = { rootPath: root, path: 'src/app/page.ts' };
  observeCompletionEvidence(state, CA2_TOOLS.find(t => t.id === 'file.read'), entry, await fileRead(entry));
  assert.ok(state.satisfied.has('repo.entrypoint'));
});


test('a failed path search cannot establish test locations from its query text', async (t) => {
  const root = ws();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = createCompletionEvidenceState({ rootPath: root, task: 'Map this repository' });
  const input = { rootPath: root, query: '*.test.ts' };
  const result = await workspaceFind(input);
  assert.deepEqual(result.matches, []);
  observeCompletionEvidence(state, CA2_TOOLS.find(t => t.id === 'workspace.find'), input, result);
  assert.equal(state.satisfied.has('repo.tests'), false, 'the echoed query is not a found path');
});


test('prose recovery cannot finish an unchecked plan', async () => {
  const prose = 'The source was inspected and this is a detailed inspection report. The tests still require inspection before this task can finish.';
  const events = await collect(streamed([
    '{"action":{"tool":"plan.update","input":{"steps":["inspect source","inspect tests"]}}}',
    '{"action":{"tool":"file.readRange","input":{"path":"src/index.ts","startLine":1,"endLine":5}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    prose, prose,
    '{"action":{"tool":"file.readRange","input":{"path":"tests/index.test.ts","startLine":1,"endLine":5}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[2]}}}',
    '{"final":"The source and tests have both been inspected."}',
  ]), 'Inspect source and tests');
  assert.deepEqual(events.filter(e => e.type === 'final').map(e => e.markdown), [
    'The source and tests have both been inspected.',
  ]);
  assert.equal(events.filter(e => e.type === 'step' && e.tool === 'file.readRange').length, 2);
});

test('proposal summary recovery cannot finish while plan work remains', async () => {
  const { deps } = scriptedDeps([
    '{"action":{"tool":"plan.update","input":{"steps":["propose source","inspect tests"]}}}',
    '{"action":{"tool":"edit.preview","input":{"changes":[{"path":"a.ts","startLine":1,"endLine":1,"replacement":"y"}]}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[1]}}}',
    'not json', 'still not json',
    '{"action":{"tool":"file.readRange","input":{"path":"tests/a.test.ts","startLine":1,"endLine":5}}}',
    '{"action":{"tool":"plan.update","input":{"complete":[2]}}}',
    '{"final":"The change is proposed and existing tests were inspected. No commands were run."}',
  ]);
  const events = await drain(runEngineerTask(deps, { rootPath: '/workspace', task: 'Propose source and inspect tests' }));
  const finals = events.filter(e => e.type === 'final');
  assert.equal(finals.length, 1);
  assert.match(finals[0]!.markdown, /existing tests were inspected/);
  assert.match(finals[0]!.markdown, /NOT applied/);
  assert.ok(events.find(e => e.type === 'step' && e.tool === 'file.readRange'));
});

test('R2: controller semantic state survives a simulated Brain restart without repeating accepted inspection', async () => {
  type RuntimeCheckpoint = import('../src/engine/engineer/engineerRuntime.js').EngineerRuntimeCheckpoint;

  const mapTask =
    'Map this repository. Identify the repository root, top-level directories, package/build manifests, application entrypoints, test locations, deployment/runtime configuration, and current Git state. Do not modify anything. Support the map with file paths.';

  const toolCalls: Array<{ run: number; tool: string; input: unknown }> = [];
  let durable: RuntimeCheckpoint | undefined;

  const tools: EngineerToolInfo[] = [
    {
      id: 'workspace.list',
      description: 'list',
      readOnly: true,
      evidenceSemantics: ['workspace.directory_listing'],
      inputHint: '{}',
    },
    {
      id: 'git.status',
      description: 'git',
      readOnly: true,
      evidenceSemantics: ['vcs.state'],
      inputHint: '{}',
    },
    {
      id: 'file.read',
      description: 'read',
      readOnly: true,
      evidenceSemantics: ['workspace.file_content'],
      inputHint: '{}',
    },
  ];

  // ── Process / Brain instance #1 ──────────────────────────────────────────
  {
    const replies = [
      '{"action":{"tool":"plan.update","input":{"steps":["inspect root and git","read manifest","inspect source entrypoint","inspect tests"]}}}',
      '{"action":{"tool":"workspace.list","input":{"path":"."}}}',
      '{"action":{"tool":"git.status","input":{}}}',
      '{"action":{"tool":"file.read","input":{"path":"package.json"}}}',
      '{"action":{"tool":"plan.update","input":{"complete":[1,2]}}}',
      // More work would follow, but the process disappears here.
    ];

    let i = 0;

    const gen = runEngineerTask(
      {
        complete: async () => replies[Math.min(i++, replies.length - 1)]!,
        executeTool: async (tool, input) => {
          toolCalls.push({ run: 1, tool, input });

          if (tool === 'workspace.list') {
            return {
              dir: '.',
              entries: ['package.json', 'src', 'tests'],
              truncated: false,
            };
          }

          if (tool === 'git.status') {
            return {
              branch: 'main',
              head: 'abc123',
              clean: true,
            };
          }

          if (tool === 'file.read') {
            return {
              path: 'package.json',
              content: JSON.stringify({
                scripts: { build: 'next build', test: 'node --test' },
                dependencies: { next: '15.0.0' },
              }),
              truncated: false,
            };
          }

          throw new Error(`unexpected tool ${tool}`);
        },
        tools,
        maxSteps: 20,
        checkpoint: async (state) => {
          durable = structuredClone(state);
        },
      },
      {
        rootPath: '/w',
        task: mapTask,
        intent: 'INSPECT',
      },
    );

    /*
     * Drive until package.json and the 2/4 plan checkpoint are durable, then
     * terminate the generator as though the Brain process disappeared.
     */
    for await (const ev of gen) {
      if (
        ev.type === 'note' &&
        (ev as { kind?: string; message?: string }).kind === 'plan' &&
        /PLAN \(2\/4 done\)/.test(
          (ev as { message?: string }).message ?? '',
        )
      ) {
        break;
      }
    }
  }

  assert.ok(durable, 'semantic checkpoint must exist before restart');
  assert.equal(durable!.plan.filter((s) => s.done).length, 2);

  assert.deepEqual(
    [...durable!.completionEvidence.satisfied].sort(),
    [
      'repo.deployment_runtime',
      'repo.framework_runtime',
      'repo.git_state',
      'repo.manifest_contents',
      'repo.root',
      'repo.top_level',
    ].sort(),
    'first Brain must durably checkpoint every obligation earned before restart',
  );
  assert.ok(
    durable!.observations.some(
      (o) =>
        o.tool === 'file.read' &&
        JSON.stringify(o.input).includes('package.json'),
    ),
    'package manifest observation survived',
  );

  const callsBeforeResume = toolCalls.length;

  // ── Process / Brain instance #2 ──────────────────────────────────────────
  {
    const prompts: string[] = [];

    const replies = [
      /*
       * Deliberately ask for the SAME package read first. The reconstructed
       * duplicate cache must reuse the accepted observation rather than execute
       * it again.
       */
      '{"action":{"tool":"file.read","input":{"path":"package.json"}}}',
      '{"action":{"tool":"workspace.list","input":{"path":"src/app"}}}',
      '{"action":{"tool":"file.read","input":{"path":"src/app/page.tsx"}}}',
      '{"action":{"tool":"workspace.list","input":{"path":"tests"}}}',
      '{"action":{"tool":"plan.update","input":{"complete":[3,4]}}}',
      '{"final":"Repository mapping is complete: the manifest, source entrypoint, tests, deployment/runtime configuration, root structure, and Git state were inspected."}',
    ];

    let i = 0;

    const events = await drain(
      runEngineerTask(
        {
          complete: async (prompt) => {
            prompts.push(prompt);
            return replies[Math.min(i++, replies.length - 1)]!;
          },
          executeTool: async (tool, input) => {
            toolCalls.push({ run: 2, tool, input });

            const path =
              typeof input === 'object' &&
              input !== null &&
              'path' in input
                ? String((input as { path?: unknown }).path ?? '')
                : '';

            if (tool === 'workspace.list' && path === 'src/app') {
              return {
                dir: 'src/app',
                entries: ['page.tsx', 'layout.tsx'],
                truncated: false,
              };
            }

            if (tool === 'file.read' && path === 'src/app/page.tsx') {
              return {
                path,
                content: 'export default function Page(){ return null; }',
                truncated: false,
              };
            }

            if (tool === 'workspace.list' && path === 'tests') {
              return {
                dir: 'tests',
                entries: ['payments.test.ts'],
                truncated: false,
              };
            }

            throw new Error(
              `unexpected resumed execution: ${tool} ${path}`,
            );
          },
          tools,
          maxSteps: 20,
          checkpoint: async (state) => {
            durable = structuredClone(state);
          },
        },
        {
          rootPath: '/w',
          task: mapTask,
          intent: 'INSPECT',
          resume: durable!,
        },
      ),
    );

    assert.ok(
      prompts[0]?.includes('ENGINEER RESUME STATE'),
      'the resumed model receives explicit controller-owned resume context',
    );

    assert.ok(
      prompts[0]?.includes('package.json'),
      'accepted manifest observation is supplied to the resumed model',
    );

    assert.ok(
      events.some(
        (ev) =>
          ev.type === 'note' &&
          (ev as { kind?: string }).kind === 'duplicate',
      ),
      'the already accepted package read is reused rather than re-executed',
    );

    assert.equal(
      events.filter((ev) => ev.type === 'final').length,
      1,
      'resumed task reaches exactly one accepted final',
    );
  }

  const resumedCalls = toolCalls.slice(callsBeforeResume);

  assert.equal(
    resumedCalls.filter(
      (c) =>
        c.tool === 'file.read' &&
        JSON.stringify(c.input).includes('package.json'),
    ).length,
    0,
    'accepted package read must not execute again after restart',
  );

  assert.equal(
    durable!.plan.filter((s) => s.done).length,
    4,
    'restored plan continues to completion rather than restarting at zero',
  );

  assert.deepEqual(
    missingCompletionObligations(
      restoreCompletionEvidence(durable!.completionEvidence),
    ),
    [],
    'controller completion evidence remains authoritative across restart',
  );
});
