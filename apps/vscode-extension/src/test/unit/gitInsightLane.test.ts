// Acceptance for read-only Git visibility, extension side.
//
// The engine's correctness against a real worktree is proven in brain-service. What is
// asserted here is what the extension must not lose: it asks structured questions, it never
// shells out, it fails closed, and it never reports a number it did not receive.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  formatGitReport,
  runGitInsightFlow,
  type GitHistory,
  type GitOverview,
} from '../../services/gitInsightFlow.js';

const overview = (patch: Partial<GitOverview> = {}): GitOverview => ({
  branch: 'main',
  head: 'a'.repeat(40),
  headShort: 'aaaaaaa',
  detached: false,
  ahead: null,
  behind: null,
  counts: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 },
  diffSummary: {
    stagedFiles: 0,
    stagedInsertions: 0,
    stagedDeletions: 0,
    unstagedFiles: 0,
    unstagedInsertions: 0,
    unstagedDeletions: 0,
  },
  ...patch,
});

const history = (patch: Partial<GitHistory> = {}): GitHistory => ({
  head: 'a'.repeat(40),
  branch: 'main',
  commits: [
    { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', author: 'Bonex', authoredAt: '2026-08-20T10:00:00Z', subject: 'do a thing' },
  ],
  truncated: false,
  ...patch,
});

test('renders branch, HEAD and recent commits', async () => {
  const outcome = await runGitInsightFlow({
    rootPath: '/w',
    limit: 15,
    source: { overview: async () => overview(), history: async () => history() },
  });
  assert.equal(outcome.status, 'ok');
  if (outcome.status !== 'ok') return;
  assert.match(outcome.report, /Branch: main/);
  assert.match(outcome.report, /HEAD:\s+aaaaaaa/);
  assert.match(outcome.report, /aaaaaaa\s+2026-08-20\s+Bonex\s+do a thing/);
});

test('a clean worktree says CLEAN rather than listing zeroes', async () => {
  const outcome = await runGitInsightFlow({
    rootPath: '/w',
    limit: 15,
    source: { overview: async () => overview(), history: async () => history() },
  });
  if (outcome.status !== 'ok') throw new Error('expected ok');
  assert.match(outcome.report, /Worktree: clean/);
});

test('STAGED, UNSTAGED and UNTRACKED are reported distinctly', async () => {
  const outcome = await runGitInsightFlow({
    rootPath: '/w',
    limit: 15,
    source: {
      overview: async () => overview({ counts: { staged: 2, unstaged: 3, untracked: 1, conflicted: 0 } }),
      history: async () => history(),
    },
  });
  if (outcome.status !== 'ok') throw new Error('expected ok');
  assert.match(outcome.report, /2 staged, 3 unstaged, 1 untracked/);
});

test('a conflict is surfaced loudly, not folded into "unstaged"', () => {
  const report = formatGitReport(
    overview({ counts: { staged: 0, unstaged: 1, untracked: 0, conflicted: 2 } }),
    history(),
  );
  assert.match(report, /2 CONFLICTED/);
});

test('NO UPSTREAM is reported as none, never as "0 ahead, 0 behind"', () => {
  const none = formatGitReport(overview({ ahead: null, behind: null }), history());
  assert.match(none, /Upstream: none configured/);
  assert.ok(!/0 ahead, 0 behind/.test(none), 'null is not zero — zero would claim we compared');

  const synced = formatGitReport(overview({ ahead: 0, behind: 0 }), history());
  assert.match(synced, /Upstream: 0 ahead, 0 behind/);
});

test('a detached HEAD is named as detached', () => {
  const report = formatGitReport(overview({ detached: true, branch: null }), history());
  assert.match(report, /HEAD detached at aaaaaaa/);
});

test('a repository with no commits says so instead of inventing a sha', () => {
  const report = formatGitReport(
    overview({ head: null, headShort: null }),
    history({ head: null, commits: [] }),
  );
  assert.match(report, /\(no commits yet\)/);
  assert.match(report, /No commits yet\./);
});

test('truncated history is disclosed', () => {
  const report = formatGitReport(overview(), history({ truncated: true }));
  assert.match(report, /more not shown/);
});

test('FAIL CLOSED: an unreachable Brain reports unavailable, never a stale status', async () => {
  const outcome = await runGitInsightFlow({
    rootPath: '/w',
    limit: 15,
    source: {
      overview: async () => {
        throw new Error('local_runner_unavailable');
      },
      history: async () => history(),
    },
  });
  assert.equal(outcome.status, 'unavailable');
  if (outcome.status !== 'unavailable') return;
  assert.match(outcome.reason, /unavailable/);
});

test('no workspace folder is refused before any request is made', async () => {
  let called = false;
  const outcome = await runGitInsightFlow({
    rootPath: undefined,
    limit: 15,
    source: {
      overview: async () => {
        called = true;
        return overview();
      },
      history: async () => history(),
    },
  });
  assert.equal(outcome.status, 'unavailable');
  assert.equal(called, false);
});

test('THE EXTENSION NEVER SHELLS OUT FOR GIT', () => {
  for (const relative of ['services/gitInsightFlow.ts', 'commands/gitOverview.ts']) {
    const source = readFileSync(path.resolve(__dirname, '../../../src', relative), 'utf8');
    for (const forbidden of [
      'child_process',
      'execFile',
      'execSync',
      'spawn(',
      'simple-git',
      "'.git'",
      'node:fs',
    ]) {
      assert.ok(!source.includes(forbidden), `${relative} must not reference "${forbidden}"`);
    }
  }
});

test('the lane cannot request arbitrary Git execution', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/commands/gitOverview.ts'), 'utf8');
  // Only the two fixed capability ids may appear; no subcommand or flag is ever assembled.
  assert.match(source, /'git\.overview'/);
  assert.match(source, /'git\.history'/);
  for (const forbidden of ['git.commit', 'git.push', 'git.checkout', "'git '", 'args', '--force']) {
    assert.ok(!source.includes(forbidden), `must not reference "${forbidden}"`);
  }
});

test('`git` is NOT added to the ad-hoc command allowlist by this lane', () => {
  const source = readFileSync(path.resolve(__dirname, '../../../src/services/commandInput.ts'), 'utf8');
  assert.ok(!source.includes("'git'"), 'the command lane must not learn about git');
});

test('every contributed command is registered exactly once, at the top level', () => {
  // A registration nested inside another registerCommand call typechecks — it becomes the
  // third `thisArg` parameter — and silently never registers. This asserts the shape.
  const pkg = JSON.parse(
    readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
  ) as { contributes: { commands: Array<{ command: string }> } };
  // Scan ALL sources: a command may legitimately register inside a helper module
  // (governedCoding does), so scanning extension.ts alone would report a false gap.
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (full.endsWith('.ts')) out.push(full);
    }
    return out;
  };
  const srcRoot = path.resolve(__dirname, '../../../src');
  const all = walk(srcRoot).map((f) => readFileSync(f, 'utf8')).join('\n');
  const registered = new Set(
    [...all.matchAll(/registerCommand\(\s*'([^']+)'/g)].map((m) => m[1] as string),
  );
  const source = readFileSync(path.resolve(srcRoot, 'extension.ts'), 'utf8');
  for (const { command } of pkg.contributes.commands) {
    assert.ok(registered.has(command), `${command} is contributed but never registered`);
  }
  // and none may sit inside another registration's argument list
  assert.ok(
    !/registerCommand\([^)]*\n\s*vscode\.commands\.registerCommand/.test(source),
    'a registerCommand call must not be nested inside another',
  );
});
