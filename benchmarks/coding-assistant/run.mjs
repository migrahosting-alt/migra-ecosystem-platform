// MigraPilot capability benchmark — controlled runner.
//
// Every (tool, task) pair starts from a byte-identical clone of the pristine
// fixture, gets the SAME prompt, and is judged by hidden suites the tool never
// saw. What is measured mechanically is measured mechanically; what needs
// judgement is captured as evidence and left for a human, clearly labelled.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks/tasks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixture');
const VERIFY = path.join(HERE, 'verify');
const RESULTS = path.join(HERE, 'results');

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** A pristine clone of the fixture with the task's setup applied and committed. */
export function prepare(task) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bench-${task.id}-`));
  fs.cpSync(FIXTURE, root, { recursive: true });
  const applySetup = () => {
    for (const patch of task.setup ?? []) {
      const file = path.join(root, patch.file);
      const before = fs.readFileSync(file, 'utf8');
      if (!before.includes(patch.find)) throw new Error(`setup anchor missing in ${patch.file} for ${task.id}`);
      fs.writeFileSync(file, before.replace(patch.find, patch.replace));
    }
  };

  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'bench@migrapilot.test']);
  git(root, ['config', 'user.name', 'bench']);

  if (task.kind === 'review') {
    // The defect must arrive as an UNCOMMITTED change: the task is to review a
    // dirty diff, so the baseline commit has to be the clean tree.
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'benchmark baseline']);
    applySetup();
  } else {
    applySetup();
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'benchmark baseline']);
  }
  return root;
}

/** Run the visible suite exactly as a user would. */
export function runVisibleSuite(root) {
  const started = Date.now();
  const res = spawnSync('npm', ['test', '--silent'], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const num = (re) => Number(output.match(re)?.[1] ?? 0);
  return { exitCode: res.status, passed: num(/# pass (\d+)/), failed: num(/# fail (\d+)/), ms: Date.now() - started, output };
}

/** Run a hidden suite against the tool's result. Copied in, run, removed. */
export function runHidden(root, files) {
  if (!files?.length) return { applicable: false };
  const staging = path.join(root, '.bench-verify');
  fs.mkdirSync(staging, { recursive: true });
  for (const f of files) fs.copyFileSync(path.join(VERIFY, f), path.join(staging, f));
  for (const extra of fs.readdirSync(VERIFY).filter((f) => f.endsWith('.json'))) {
    fs.copyFileSync(path.join(VERIFY, extra), path.join(staging, extra));
  }
  const res = spawnSync('node', ['--test', ...files.map((f) => path.join('.bench-verify', f))], {
    cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NODE_TEST_CONTEXT: undefined, NODE_OPTIONS: undefined },
  });
  const output = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const num = (re) => Number(output.match(re)?.[1] ?? 0);
  fs.rmSync(staging, { recursive: true, force: true });
  return { applicable: true, exitCode: res.status, passed: num(/# pass (\d+)/), failed: num(/# fail (\d+)/), output };
}

/** Objective scope facts: what the tool actually touched. */
export function scope(root) {
  const status = git(root, ['status', '--porcelain']).stdout ?? '';
  const files = status.split('\n').filter(Boolean).map((l) => l.slice(3).trim()).filter((f) => !f.startsWith('.bench-'));
  const numstat = (git(root, ['diff', '--numstat']).stdout ?? '').split('\n').filter(Boolean);
  let added = 0, removed = 0;
  for (const line of numstat) {
    const [a, r] = line.split('\t');
    added += Number(a) || 0;
    removed += Number(r) || 0;
  }
  return { files, added, removed, touchedTests: files.some((f) => f.startsWith('test/')) };
}

export { TASKS, FIXTURE, VERIFY, RESULTS, git };
