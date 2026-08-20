// Acceptance for the AD-HOC COMMAND LANE (`POST /api/ai/command-run`).
//
// These drive the real Fastify route and the real executor — no stubbed policy —
// because the claim under test is "the existing controls still hold when reached
// through a new door", which a mock cannot establish.

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerCommandRunRoutes } from '../src/engine/commandRunRoutes.js';

function app(): FastifyInstance {
  const instance = Fastify();
  registerCommandRunRoutes(instance);
  return instance;
}
function root(): string {
  return mkdtempSync(path.join(tmpdir(), 'migrapilot-cmd-lane-'));
}
async function run(body: unknown): Promise<{ status: number; json: any }> {
  const instance = app();
  const res = await instance.inject({ method: 'POST', url: '/api/ai/command-run', payload: body as never });
  await instance.close();
  return { status: res.statusCode, json: res.json() };
}

test('runs an allowlisted command and returns truthful exit code, stdout and duration', async () => {
  const cwd = root();
  const { status, json } = await run({ rootPath: cwd, command: ['node', '-e', 'console.log("hello-lane")'] });
  assert.equal(status, 200);
  assert.equal(json.tool, 'command.run');
  assert.equal(json.exitCode, 0);
  assert.match(json.stdout, /hello-lane/);
  assert.equal(json.timedOut, false);
  assert.equal(json.truncated, false);
  assert.ok(typeof json.durationMs === 'number' && json.durationMs >= 0);
});

test('reports a non-zero exit truthfully rather than as an error', async () => {
  const { status, json } = await run({ rootPath: root(), command: ['node', '-e', 'process.exit(3)'] });
  assert.equal(status, 200);
  assert.equal(json.exitCode, 3);
});

test('stderr is captured and returned', async () => {
  const { json } = await run({ rootPath: root(), command: ['node', '-e', 'console.error("to-stderr")'] });
  assert.match(json.stderr, /to-stderr/);
});

test('argv is an ARRAY, never shell text — metacharacters are literal arguments', async () => {
  // If a shell were involved this would chain a second command. It must not.
  const { json } = await run({
    rootPath: root(),
    command: ['node', '-e', 'console.log(process.argv.slice(1).join("|"))', '&&', 'whoami'],
  });
  assert.equal(json.exitCode, 0);
  assert.match(json.stdout, /&&\|whoami/, 'shell metacharacters must arrive as literal argv entries');
  assert.ok(!/root|bonex/.test(json.stdout.replace(/&&\|whoami/, '')), 'no second command may execute');
});

test('a command NOT on the allowlist is refused with the reason', async () => {
  const { status, json } = await run({ rootPath: root(), command: ['git', 'status'] });
  assert.equal(status, 400);
  assert.equal(json.code, 'UNSUPPORTED');
  assert.match(json.message, /not on the allowlist/);
});

test('argv[0] containing a path separator is refused', async () => {
  const { status, json } = await run({ rootPath: root(), command: ['/usr/bin/node', '-e', '0'] });
  assert.equal(status, 400);
  assert.match(json.message, /bare program name/);
});

test('publish, deploy, release and push remain refused', async () => {
  for (const denied of ['publish', 'deploy', 'release', 'push']) {
    const { status, json } = await run({ rootPath: root(), command: ['npm', denied] });
    assert.equal(status, 400, `${denied} must be refused`);
    assert.match(json.message, /external-effect action/);
  }
});

test('cwd escaping the workspace root is refused', async () => {
  const { status, json } = await run({ rootPath: root(), command: ['node', '-e', '0'], cwd: '../..' });
  assert.equal(status, 400);
  assert.match(json.message, /escapes the workspace root|does not exist/);
});

test('an absolute cwd is refused', async () => {
  const { status, json } = await run({ rootPath: root(), command: ['node', '-e', '0'], cwd: '/tmp' });
  assert.equal(status, 400);
  assert.match(json.message, /must be relative/);
});

test('cwd is constrained to the workspace: the command runs INSIDE it', async () => {
  const base = root();
  const { json } = await run({ rootPath: base, command: ['node', '-e', 'console.log(process.cwd())'] });
  assert.ok(json.stdout.trim().length > 0);
  // realpath-normalised comparison — macOS /var vs /private/var, WSL symlinks
  assert.ok(json.stdout.includes(path.basename(base)), 'cwd must be the workspace root');
});

test('environment keys that can substitute the executable are refused', async () => {
  const { status, json } = await run({
    rootPath: root(), command: ['node', '-e', '0'], environment: { PATH: '/evil' },
  });
  assert.equal(status, 400);
  assert.match(json.message, /alter executable resolution/);
});

test('TIMEOUT: a long command is killed and reported as timedOut', async () => {
  const { status, json } = await run({
    rootPath: root(), command: ['node', '-e', 'setTimeout(()=>{},60000)'], timeoutMs: 300,
  });
  assert.equal(status, 200);
  assert.equal(json.timedOut, true, 'the timeout must be reported truthfully');
  assert.notEqual(json.exitCode, 0);
});

test('INTERACTIVE: a command awaiting stdin gets EOF and terminates, never hangs', async () => {
  const { status, json } = await run({
    rootPath: root(),
    // reads stdin to completion; with stdin 'ignore' this resolves immediately at EOF
    command: ['node', '-e', 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{console.log("eof:"+d.length);});'],
    timeoutMs: 5000,
  });
  assert.equal(status, 200);
  assert.equal(json.timedOut, false, 'stdin is closed, so an interactive read must not hang');
  assert.match(json.stdout, /eof:0/);
});

test('OUTPUT CAP: a chatty command is truncated, not allowed to flood', async () => {
  const { json } = await run({
    rootPath: root(),
    command: ['node', '-e', 'console.log("x".repeat(200000))'],
    timeoutMs: 20000,
  });
  assert.equal(json.truncated, true);
  assert.ok(json.stdout.length <= 24 * 1024, `stdout must be capped, saw ${json.stdout.length}`);
});

test('KILL SWITCH: MIGRAPILOT_COMMAND_RUN=off refuses every dispatch', async () => {
  const previous = process.env.MIGRAPILOT_COMMAND_RUN;
  process.env.MIGRAPILOT_COMMAND_RUN = 'off';
  try {
    const { status, json } = await run({ rootPath: root(), command: ['node', '-e', '0'] });
    assert.equal(status, 400);
    assert.match(json.message, /disabled/);
  } finally {
    if (previous === undefined) delete process.env.MIGRAPILOT_COMMAND_RUN;
    else process.env.MIGRAPILOT_COMMAND_RUN = previous;
  }
});

test('a missing rootPath is refused rather than defaulting somewhere', async () => {
  const { status } = await run({ rootPath: path.join(tmpdir(), 'no-such-root-xyz'), command: ['node', '-e', '0'] });
  assert.equal(status, 400);
});

test('a real project command runs: node --version inside the workspace', async () => {
  const base = root();
  writeFileSync(path.join(base, 'package.json'), JSON.stringify({ name: 'probe', version: '1.0.0' }));
  const { json } = await run({ rootPath: base, command: ['node', '--version'] });
  assert.equal(json.exitCode, 0);
  assert.match(json.stdout.trim(), /^v\d+\./);
});
