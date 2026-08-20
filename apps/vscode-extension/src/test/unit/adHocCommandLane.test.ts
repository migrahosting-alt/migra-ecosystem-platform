// Acceptance for the ad-hoc command lane, extension side.
//
// The interesting failures are: silently reinterpreting shell syntax, executing
// locally as a "shortcut", and turning an unreachable Brain into something that looks
// like a completed run. Each is asserted here.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { formatCommandResult, parseCommandInput } from '../../services/commandInput.js';
import { runAdHocCommandFlow } from '../../services/adHocCommandFlow.js';

test('parses a plain command into an argv array', () => {
  const parsed = parseCommandInput('npm test');
  assert.deepEqual(parsed, { ok: true, argv: ['npm', 'test'] });
});

test('keeps quoted arguments together without invoking shell semantics', () => {
  const parsed = parseCommandInput('npm test -- --testNamePattern "my case"');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.argv, ['npm', 'test', '--', '--testNamePattern', 'my case']);
});

test('preserves an intentionally empty quoted argument', () => {
  const parsed = parseCommandInput('node -e ""');
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.argv, ['node', '-e', '']);
});

test('REFUSES shell metacharacters instead of silently passing them as literals', () => {
  for (const [input, needle] of [
    ['npm test && echo done', 'chaining'],
    ['npm test || true', 'chaining'],
    ['npm test | grep fail', 'pipes'],
    ['npm test; ls', 'sequencing'],
    ['npm test > out.txt', 'redirection'],
    ['node -e `whoami`', 'substitution'],
    ['node -e $(whoami)', 'substitution'],
  ] as const) {
    const parsed = parseCommandInput(input);
    assert.equal(parsed.ok, false, `${input} must be refused`);
    if (!parsed.ok) assert.match(parsed.reason, new RegExp(needle));
  }
});

test('refuses a path-like program name (the Brain requires a bare name)', () => {
  const parsed = parseCommandInput('/usr/bin/node --version');
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.match(parsed.reason, /bare name/);
});

test('refuses empty input, newlines and unbalanced quotes', () => {
  for (const input of ['', '   ', 'npm test\nls', 'npm test "unbalanced']) {
    assert.equal(parseCommandInput(input).ok, false, `${JSON.stringify(input)} must be refused`);
  }
});

test('formats a successful run truthfully', () => {
  const text = formatCommandResult({
    argv: ['node', '--version'], cwd: '/w', exitCode: 0, timedOut: false,
    truncated: false, redacted: false, durationMs: 12, stdout: 'v22.0.0\n', stderr: '',
  });
  assert.match(text, /> node --version/);
  assert.match(text, /Running in:\n\/w/);
  assert.match(text, /Exit: 0 {2}\(12 ms\)/);
  assert.match(text, /stdout:\nv22\.0\.0/);
});

test('formats a timeout as a timeout, not as an exit code', () => {
  const text = formatCommandResult({
    argv: ['npm', 'test'], cwd: '/w', exitCode: null, timedOut: true,
    truncated: false, redacted: false, durationMs: 300, stdout: '', stderr: '',
  });
  assert.match(text, /TIMED OUT after 300 ms \(process killed\)/);
});

test('surfaces truncation and redaction rather than hiding them', () => {
  const text = formatCommandResult({
    argv: ['npm', 'test'], cwd: '/w', exitCode: 0, timedOut: false,
    truncated: true, redacted: true, durationMs: 5, stdout: 'x', stderr: '',
  });
  assert.match(text, /truncated at the server cap/);
  assert.match(text, /redacted before the output left the Brain/);
});

test('a run with no output says so instead of rendering blank sections', () => {
  const text = formatCommandResult({
    argv: ['node', '-e', '0'], cwd: '/w', exitCode: 0, timedOut: false,
    truncated: false, redacted: false, durationMs: 1, stdout: '', stderr: '',
  });
  assert.match(text, /\(no output\)/);
});

test('NO LOCAL EXECUTION: neither the lane nor its parser can spawn a process', () => {
  for (const relative of ['commands/runCommand.ts', 'services/commandInput.ts', 'services/adHocCommandFlow.ts']) {
    const source = readFileSync(path.resolve(__dirname, '../../../src', relative), 'utf8');
    const code = source.slice(source.lastIndexOf('// ') === -1 ? 0 : 0);
    for (const forbidden of ['child_process', 'spawn(', 'execFile', 'execSync', 'node:child_process']) {
      assert.ok(!code.includes(forbidden), `${relative} must not reference "${forbidden}"`);
    }
  }
});

test('the lane documents why it is not Agent Mode', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/commands/runCommand.ts'), 'utf8');
  assert.match(source, /AD-HOC COMMAND LANE/);
  assert.match(source, /Agent Mode/);
  assert.match(source, /no autonomous follow-up/i);
  assert.match(source, /NOTHING EXECUTES LOCALLY/);
});

// --- lane behaviour: refusal, failure and fail-closed --------------------------------
//
// Driven through the real flow module with an injected UI and a stub runner, so these
// assert the production control flow rather than a re-implementation of it.

test('FAIL CLOSED: an unreachable Brain reports that the command did NOT run', async () => {
  const captured = { refusals: [] as string[], results: [] as Array<{ text: string; failed: boolean }> };
  await runAdHocCommandFlow({
    workspaceRoot: '/w',
    ui: {
      prompt: async () => 'node --version',
      showRefusal: async (m) => { captured.refusals.push(m); },
      showResult: async (text, failed) => { captured.results.push({ text, failed }); },
    },
    runner: { runCommand: async () => { throw new Error('local_runner_unavailable'); } },
  });
  assert.equal(captured.results.length, 0, 'nothing may be presented as a completed run');
  assert.equal(captured.refusals.length, 1);
  assert.match(captured.refusals[0]!, /was NOT run/);
});

test('a policy refusal from the Brain is shown as a refusal, not a result', async () => {
  const captured = { refusals: [] as string[], results: [] as unknown[] };
  await runAdHocCommandFlow({
    workspaceRoot: '/w',
    ui: {
      prompt: async () => 'git status',
      showRefusal: async (m) => { captured.refusals.push(m); },
      showResult: async () => { captured.results.push(1); },
    },
    runner: { runCommand: async () => ({ ok: false, refusal: 'command "git" is not on the allowlist' }) },
  });
  assert.equal(captured.results.length, 0);
  assert.match(captured.refusals[0]!, /not on the allowlist/);
});

test('a non-zero exit is a RESULT (flagged failed), never a refusal', async () => {
  const captured = { refusals: [] as string[], results: [] as Array<{ text: string; failed: boolean }> };
  await runAdHocCommandFlow({
    workspaceRoot: '/w',
    ui: {
      prompt: async () => 'npm test',
      showRefusal: async (m) => { captured.refusals.push(m); },
      showResult: async (text, failed) => { captured.results.push({ text, failed }); },
    },
    runner: {
      runCommand: async () => ({ ok: true, result: { exitCode: 1, timedOut: false, truncated: false, redacted: false, durationMs: 9, stdout: '', stderr: 'boom' } }),
    },
  });
  assert.equal(captured.refusals.length, 0);
  assert.equal(captured.results[0]!.failed, true);
  assert.match(captured.results[0]!.text, /Exit: 1/);
});

test('a shell metacharacter never reaches the Brain', async () => {
  let called = false;
  const refusals: string[] = [];
  await runAdHocCommandFlow({
    workspaceRoot: '/w',
    ui: { prompt: async () => 'npm test && rm -rf /', showRefusal: async (m) => { refusals.push(m); }, showResult: async () => {} },
    runner: { runCommand: async () => { called = true; return { ok: false, refusal: 'unreachable' }; } },
  });
  assert.equal(called, false, 'the lane must refuse before dispatching');
  assert.match(refusals[0]!, /chaining/);
});

test('no workspace folder is refused before anything is dispatched', async () => {
  let called = false;
  const refusals: string[] = [];
  await runAdHocCommandFlow({
    workspaceRoot: undefined,
    ui: { prompt: async () => 'npm test', showRefusal: async (m) => { refusals.push(m); }, showResult: async () => {} },
    runner: { runCommand: async () => { called = true; return { ok: false, refusal: 'x' }; } },
  });
  assert.equal(called, false);
  assert.match(refusals[0]!, /workspace folder/);
});
