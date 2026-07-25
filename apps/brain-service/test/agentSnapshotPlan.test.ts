import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, ftruncateSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, statSync, symlinkSync, utimesSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { AgentRecipePolicyError, AgentRecipeResolver, AGENT_SNAPSHOT_TEMP_PREFIX, scavengeStaleAgentSnapshots } from '../src/engine/agentRecipe.js';
import {
  materializeGovernedSnapshot,
  planGovernedSnapshot,
  SnapshotPlanError,
  type GitPathEnumerator,
} from '../src/engine/agentSnapshotPlan.js';

const ACTIVATION = 'agentact_snapshot_plan';

// Test files run in parallel processes and snapshot roots are created under the
// process temporary directory. Redirect this file's temporary directory so that
// counting snapshot directories cannot race another file's real resolver.
const PRIVATE_TMP = mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-suite-'));
process.env.TMPDIR = PRIVATE_TMP;

const GIT_ENV: NodeJS.ProcessEnv = {
  PATH: process.env.PATH ?? '/usr/bin:/bin',
  HOME: '/nonexistent',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Snapshot Test',
  GIT_AUTHOR_EMAIL: 'snapshot@test.invalid',
  GIT_COMMITTER_NAME: 'Snapshot Test',
  GIT_COMMITTER_EMAIL: 'snapshot@test.invalid',
  GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
  GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root: string, relative: string, contents: string): string {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
  return target;
}

/** Apparent size without disk cost, so limit and exclusion behaviour can be
 * proven against hundreds of megabytes in a fast test. */
function sparseFile(root: string, relative: string, bytes: number): void {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  const fd = openSync(target, 'w');
  ftruncateSync(fd, bytes);
  closeSync(fd);
}

/** A committed repository whose tracked material is small but which is
 * surrounded by ignored bulk, mirroring the canonical workspace shape. */
function makeRepo(options: { ignoredBytes?: number; ignoredFiles?: number } = {}): string {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-plan-'));
  git(root, 'init', '--quiet', '-b', 'main');
  write(root, '.gitignore', 'node_modules/\ndist/\n*.log\nmodels/\n');
  write(root, 'src/app.ts', 'export const value = 1;\n');
  write(root, 'docs/readme.md', 'tracked docs\n');
  const script = write(root, 'scripts/run.sh', '#!/bin/sh\necho run\n');
  chmodSync(script, 0o755);
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'initial');
  if (options.ignoredBytes) sparseFile(root, 'models/weights.bin', options.ignoredBytes);
  for (let index = 0; index < (options.ignoredFiles ?? 0); index += 1) {
    write(root, `node_modules/pkg-${index}/index.js`, `module.exports = ${index};\n`);
  }
  return root;
}

function workspaceIdentityOf(root: string): string {
  const info = statSync(root);
  return `${info.dev}:${info.ino}:${info.birthtimeMs}:${info.ctimeMs}`;
}

function prepareContext(root: string, runId = 'agentcmd_snapshot_plan'): { runId: string; activationId: string; workspaceIdentity: string } {
  return { runId, activationId: ACTIVATION, workspaceIdentity: workspaceIdentityOf(root) };
}

/** Runs the governed recipe exactly as the plan declares it: the snapshot's own
 * copied Git binary, hardened argv, minimal environment, snapshot cwd. */
function runRecipe(prepared: { identity: { executablePath: string; arguments: string[]; canonicalCwd: string } ; environment: NodeJS.ProcessEnv }): string {
  return execFileSync(prepared.identity.executablePath, prepared.identity.arguments, {
    cwd: prepared.identity.canonicalCwd,
    env: prepared.environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function snapshotTempDirs(): string[] {
  return readdirSync(tmpdir()).filter((entry) => entry.startsWith(AGENT_SNAPSHOT_TEMP_PREFIX));
}

function relatives(plan: { entries: { relative: string }[] }): string[] {
  return plan.entries.map((entry) => entry.relative);
}

// (a) A small tracked repository surrounded by huge ignored content plans only
// the governed material.
test('governed plan excludes ignored bulk from a small tracked repository', async () => {
  const root = makeRepo({ ignoredBytes: 512 * 1024 * 1024, ignoredFiles: 200 });
  const plan = await planGovernedSnapshot(root);
  const paths = relatives(plan);
  assert.ok(paths.includes('src/app.ts'));
  assert.ok(paths.includes('docs/readme.md'));
  assert.ok(paths.includes('.gitignore'));
  assert.ok(paths.some((entry) => entry === path.join('.git', 'index')));
  assert.equal(paths.some((entry) => entry.includes('node_modules')), false);
  assert.equal(paths.some((entry) => entry.includes('models')), false);
  // 512MB of ignored material must not appear in the bounded byte accounting.
  assert.ok(plan.totalBytes < 8 * 1024 * 1024, `expected small governed payload, got ${plan.totalBytes}`);
  assert.equal(plan.trackedFiles, 4);
});

// (b) Ignored dependencies are never materialized.
test('ignored node_modules is not copied into the snapshot', async () => {
  const root = makeRepo({ ignoredFiles: 50 });
  const plan = await planGovernedSnapshot(root);
  const destination = path.join(mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-out-')), 'workspace');
  await materializeGovernedSnapshot(root, destination, plan);
  assert.equal(existsSync(path.join(destination, 'src', 'app.ts')), true);
  assert.equal(existsSync(path.join(destination, 'node_modules')), false);
  assert.equal(existsSync(path.join(destination, '.git', 'index')), true);
});

// (c) + (d) + (e) Git semantics are preserved inside the bounded snapshot.
test('bounded snapshot reports tracked modifications, untracked files, and hides ignored files', async () => {
  const root = makeRepo({ ignoredBytes: 256 * 1024 * 1024, ignoredFiles: 25 });
  write(root, 'src/app.ts', 'export const value = 2;\n');
  write(root, 'docs/new-note.md', 'untracked but not ignored\n');
  write(root, 'debug.log', 'ignored untracked\n');
  const resolver = new AgentRecipeResolver();

  const status = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_semantics_status'));
  const statusOut = runRecipe(status);
  assert.match(statusOut, / M src\/app\.ts/);
  assert.match(statusOut, /\?\? docs\/new-note\.md/);
  assert.equal(statusOut.includes('debug.log'), false);
  assert.equal(statusOut.includes('node_modules'), false);
  assert.equal(statusOut.includes('models'), false);
  await resolver.release(status);

  const diff = await resolver.prepare('git.diff', root, prepareContext(root, 'agentcmd_semantics_diff'));
  const diffOut = runRecipe(diff);
  assert.match(diffOut, /diff --git a\/src\/app\.ts b\/src\/app\.ts/);
  assert.match(diffOut, /-export const value = 1;/);
  assert.match(diffOut, /\+export const value = 2;/);
  await resolver.release(diff);
});

// A tracked file deleted from the working tree is still reported as deleted,
// because the governed index is snapshotted even though the payload is absent.
test('bounded snapshot reports a tracked file deleted from the working tree', async () => {
  const root = makeRepo();
  await import('node:fs/promises').then(({ rm }) => rm(path.join(root, 'docs/readme.md')));
  const resolver = new AgentRecipeResolver();
  const prepared = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_deleted'));
  assert.match(runRecipe(prepared), / D docs\/readme\.md/);
  await resolver.release(prepared);
});

// (f) The file-count limit is enforced during enumeration, before any payload
// copy is attempted.
test('enumeration exceeding the file limit fails before copying payloads', async () => {
  const root = makeRepo();
  await assert.rejects(
    () => planGovernedSnapshot(root, { maxFiles: 2 }),
    (error: unknown) => error instanceof SnapshotPlanError && error.reason === 'LIMIT_EXCEEDED',
  );
});

// (g) The byte limit is enforced during enumeration.
test('enumeration exceeding the byte limit fails before copying payloads', async () => {
  const root = makeRepo();
  // Non-ignored, so it is governed material Git would report as untracked, and
  // its size counts toward the bound without Git having to hash it.
  sparseFile(root, 'huge.bin', 2 * 1024 * 1024 * 1024);
  await assert.rejects(
    () => planGovernedSnapshot(root),
    (error: unknown) => error instanceof SnapshotPlanError && error.reason === 'LIMIT_EXCEEDED',
  );
});

// (6) Copied bytes are accounted, not only the enumerated estimate.
test('materialization enforces the byte limit against actually copied bytes', async () => {
  const root = makeRepo();
  const plan = await planGovernedSnapshot(root);
  const destination = path.join(mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-out-')), 'workspace');
  await assert.rejects(
    () => materializeGovernedSnapshot(root, destination, plan, { maxBytes: 64 }),
    (error: unknown) => error instanceof SnapshotPlanError && error.reason === 'LIMIT_EXCEEDED',
  );
});

// (h) Cancellation removes the partially created snapshot.
test('cancellation before and during preparation removes the snapshot', async () => {
  const root = makeRepo();
  const resolver = new AgentRecipeResolver();
  const before = snapshotTempDirs().length;

  const preAborted = new AbortController();
  preAborted.abort();
  await assert.rejects(
    () => resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_precancel'), preAborted.signal),
    (error: unknown) => error instanceof AgentRecipePolicyError && error.code === 'STALE',
  );

  // Abort after enumeration completes but before payloads are copied.
  const midController = new AbortController();
  const enumerateThenAbort: GitPathEnumerator = async (workspace, signal) => {
    const { enumerateGitPaths } = await import('../src/engine/agentSnapshotPlan.js');
    const result = await enumerateGitPaths(workspace, signal);
    midController.abort();
    return result;
  };
  const midResolver = new AgentRecipeResolver(process.env, process.platform, enumerateThenAbort);
  await assert.rejects(
    () => midResolver.prepare('git.status', root, prepareContext(root, 'agentcmd_midcancel'), midController.signal),
    (error: unknown) => error instanceof AgentRecipePolicyError && error.code === 'STALE',
  );

  assert.equal(snapshotTempDirs().length, before, 'cancelled preparation must leave no snapshot directory');
});

// (i) A thrown copy failure removes the partial snapshot.
test('a copy failure removes the partial snapshot', async () => {
  const root = makeRepo();
  const unreadable = path.join(root, 'src/app.ts');
  chmodSync(unreadable, 0o000);
  const resolver = new AgentRecipeResolver();
  const before = snapshotTempDirs().length;
  try {
    await assert.rejects(
      () => resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_copyfail')),
      (error: unknown) => error instanceof AgentRecipePolicyError && error.code === 'SNAPSHOT_FAILED',
    );
    assert.equal(snapshotTempDirs().length, before, 'failed preparation must leave no snapshot directory');
  } finally {
    chmodSync(unreadable, 0o644);
  }
});

// (j) Rejected planning leaves nothing behind.
test('rejected planning leaves no snapshot directory', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-plan-'));
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, '.git', 'config'), '[core]\nrepositoryformatversion=0\n');
  const resolver = new AgentRecipeResolver();
  const before = snapshotTempDirs().length;
  await assert.rejects(
    () => resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_notarepo')),
    (error: unknown) => error instanceof AgentRecipePolicyError && error.code === 'SNAPSHOT_FAILED',
  );
  assert.equal(snapshotTempDirs().length, before);
});

// (k) The snapshot is private and read-only, and the executable bit survives.
test('snapshot is private, read-only, and preserves tracked execute permission', async () => {
  const root = makeRepo();
  const resolver = new AgentRecipeResolver();
  const prepared = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_perms'));
  assert.equal(lstatSync(prepared.privateRunRoot).mode & 0o777, 0o700);
  assert.equal(lstatSync(prepared.identity.snapshotRoot).mode & 0o777, 0o500);
  assert.equal(lstatSync(path.join(prepared.identity.snapshotRoot, 'src/app.ts')).mode & 0o777, 0o400);
  // Stripping the execute bit would make Git report a spurious mode change.
  assert.equal(lstatSync(path.join(prepared.identity.snapshotRoot, 'scripts/run.sh')).mode & 0o777, 0o500);
  assert.equal(runRecipe(prepared).includes('scripts/run.sh'), false);
  await resolver.release(prepared);
});

// (l) Repository hooks, configuration, and object escapes cannot reach the
// snapshot.
test('repository hooks, config, alternates, modules, and worktrees are excluded', async () => {
  const root = makeRepo();
  const escape = mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-escape-'));
  mkdirSync(path.join(escape, 'objects'), { recursive: true });
  write(root, '.git/hooks/pre-commit', '#!/bin/sh\ntouch /tmp/migrapilot-hook-should-never-run\n');
  chmodSync(path.join(root, '.git/hooks/pre-commit'), 0o755);
  mkdirSync(path.join(root, '.git/objects/info'), { recursive: true });
  writeFileSync(path.join(root, '.git/objects/info/alternates'), `${path.join(escape, 'objects')}\n`);
  write(root, '.git/modules/nested/config', '[core]\nbare = false\n');
  write(root, '.git/worktrees/other/HEAD', 'ref: refs/heads/other\n');
  git(root, 'config', 'core.hooksPath', path.join(root, '.git/hooks'));

  const resolver = new AgentRecipeResolver();
  const prepared = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_hardening'));
  const gitDir = path.join(prepared.identity.snapshotRoot, '.git');
  assert.equal(existsSync(path.join(gitDir, 'hooks')), false);
  assert.equal(existsSync(path.join(gitDir, 'modules')), false);
  assert.equal(existsSync(path.join(gitDir, 'worktrees')), false);
  assert.equal(existsSync(path.join(gitDir, 'objects/info/alternates')), false);
  const config = await import('node:fs/promises').then(({ readFile }) => readFile(path.join(gitDir, 'config'), 'utf8'));
  assert.equal(config.includes('hooksPath = /dev/null'), true);
  assert.equal(config.includes(root), false, 'repository-local config must not survive into the snapshot');
  await resolver.release(prepared);
});

// Symlinks are reproduced verbatim and never dereferenced, so a link pointing
// outside the workspace copies no external content.
test('symlinks are reproduced verbatim without dereferencing outside content', async () => {
  const root = makeRepo();
  const outside = path.join(mkdtempSync(path.join(tmpdir(), 'migrapilot-snapshot-outside-')), 'secret.txt');
  writeFileSync(outside, 'must not be copied into the snapshot\n');
  symlinkSync(outside, path.join(root, 'escape-link'));
  symlinkSync('src/app.ts', path.join(root, 'inside-link'));
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'symlinks');

  const resolver = new AgentRecipeResolver();
  const prepared = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_symlink'));
  const escaped = path.join(prepared.identity.snapshotRoot, 'escape-link');
  assert.equal(lstatSync(escaped).isSymbolicLink(), true);
  const { readlink } = await import('node:fs/promises');
  assert.equal(await readlink(escaped), outside);
  // The link target's content was never materialized inside the snapshot.
  assert.equal(existsSync(path.join(prepared.identity.snapshotRoot, path.basename(outside))), false);
  // Verbatim reproduction is also the semantically correct representation.
  assert.equal(runRecipe(prepared).includes('escape-link'), false);
  await resolver.release(prepared);
});

// (m) Repeated proposal attempts do not accumulate temporary directories.
test('repeated proposal attempts do not accumulate temporary directories', async () => {
  const root = makeRepo();
  const resolver = new AgentRecipeResolver();
  const before = snapshotTempDirs().length;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const prepared = await resolver.prepare('git.status', root, prepareContext(root, `agentcmd_repeat_${attempt}`));
    assert.equal(snapshotTempDirs().length, before + 1);
    await resolver.release(prepared);
    assert.equal(snapshotTempDirs().length, before);
  }
});

test('startup scavenger reclaims only stale owner-owned snapshot directories', async () => {
  const scavengeRoot = mkdtempSync(path.join(tmpdir(), 'migrapilot-scavenge-root-'));
  const stale = path.join(scavengeRoot, `${AGENT_SNAPSHOT_TEMP_PREFIX}stale`);
  const fresh = path.join(scavengeRoot, `${AGENT_SNAPSHOT_TEMP_PREFIX}fresh`);
  const unrelated = path.join(scavengeRoot, 'unrelated-directory');
  for (const directory of [stale, fresh, unrelated]) mkdirSync(path.join(directory, 'workspace'), { recursive: true });
  writeFileSync(path.join(unrelated, 'keep.txt'), 'unrelated\n');
  const old = Date.now() / 1000 - 3600;
  utimesSync(stale, old, old);
  // A symlink must never be followed or removed as if it were a snapshot.
  symlinkSync(unrelated, path.join(scavengeRoot, `${AGENT_SNAPSHOT_TEMP_PREFIX}symlink`));

  const result = await scavengeStaleAgentSnapshots({ root: scavengeRoot, minAgeMs: 60_000 });
  assert.equal(existsSync(stale), false, 'stale snapshot must be reclaimed');
  assert.equal(existsSync(fresh), true, 'a snapshot young enough to be in flight must be kept');
  assert.equal(existsSync(unrelated), true, 'unrelated temporary directories must never be removed');
  assert.equal(existsSync(path.join(unrelated, 'keep.txt')), true);
  assert.ok(result.removed >= 1);
});

// (6) + (7) + (8) A real client disconnect aborts server-side snapshot planning
// and leaves no snapshot behind. This is the exact scenario that previously
// abandoned multi-gigabyte directories in /tmp.
test('a client disconnect aborts server-side snapshot planning and abandons no snapshot', async () => {
  const workspace = makeRepo();
  const { default: Fastify } = await import('fastify');
  const { AgentActivationAuthority } = await import('../src/engine/agentActivation.js');
  const { AgentModeCommandService } = await import('../src/engine/agentModeCommandService.js');
  const { registerAgentModeCommandRoutes } = await import('../src/engine/agentModeCommandRoutes.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const { enumerateGitPaths, SnapshotPlanError } = await import('../src/engine/agentSnapshotPlan.js');

  // Enumeration completes, then preparation stalls until the client goes away.
  let sawAbort = false;
  const stalling: GitPathEnumerator = async (target, signal) => {
    const result = await enumerateGitPaths(target, signal);
    await new Promise<void>((resolve, reject) => {
      const onAbort = (): void => { sawAbort = true; reject(new SnapshotPlanError('ABORTED', 'client disconnected')); };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(resolve, 20_000);
      timer.unref();
    });
    return result;
  };

  const secret = 'bootstrap-secret-'.padEnd(48, 'x');
  const activationId = '22222222-2222-4222-8222-222222222222';
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  const authority = new AgentActivationAuthority(secret, () => Date.now(), undefined, process.pid);
  const service = new AgentModeCommandService(
    toolDeps,
    undefined,
    undefined,
    new AgentRecipeResolver(process.env, process.platform, stalling),
  );
  registerAgentModeCommandRoutes(app, toolDeps, authority, service);
  const address = await app.listen({ port: 0, host: '127.0.0.1' });

  const before = snapshotTempDirs().length;
  try {
    const boot = await fetch(`${address}/api/ai/agent-mode/bootstrap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bootstrapSecret: secret, activationId, extensionProcessId: process.pid, bootstrapMode: 'inherited', workspaceRoot: workspace }),
    });
    assert.equal(boot.status, 200);
    const capability = (await boot.json() as { activationCapability: string }).activationCapability;

    const controller = new AbortController();
    const pending = fetch(`${address}/api/ai/agent-mode/commands`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-migrapilot-agent-capability': capability, 'x-migrapilot-workspace-root': workspace },
      body: JSON.stringify({ rootPath: workspace, recipe: 'git.status', reason: 'client disconnect acceptance' }),
      signal: controller.signal,
    });
    // Snapshot planning is in flight; the client times out and disconnects.
    await new Promise((resolve) => { setTimeout(resolve, 400); });
    controller.abort();
    await assert.rejects(() => pending);

    // The server must notice and unwind rather than keep consuming disk.
    for (let attempt = 0; attempt < 100 && !sawAbort; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    assert.equal(sawAbort, true, 'server-side planning must observe the client disconnect');
    for (let attempt = 0; attempt < 100 && snapshotTempDirs().length !== before; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    assert.equal(snapshotTempDirs().length, before, 'a disconnected proposal must abandon no snapshot directory');
  } finally {
    await app.close();
    await service.shutdown();
  }
});

// (8) Rejecting a proposal releases its snapshot promptly, without waiting for
// service shutdown.
test('rejecting a proposal releases its snapshot without waiting for shutdown', async () => {
  const workspace = makeRepo();
  const { default: Fastify } = await import('fastify');
  const { AgentModeCommandService } = await import('../src/engine/agentModeCommandService.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  const service = new AgentModeCommandService(toolDeps, undefined, undefined, new AgentRecipeResolver());
  const requestContext = {
    activationId: ACTIVATION,
    extensionProcessId: process.pid,
    serverInstanceId: 'brain-instance-123456789',
    workspaceRoot: workspace,
    workspaceIdentity: workspaceIdentityOf(workspace),
    allowedRecipes: ['git.status', 'git.diff'] as const,
  };
  const before = snapshotTempDirs().length;
  try {
    const proposal = await service.propose({ rootPath: workspace, recipe: 'git.status', reason: 'reject release' }, requestContext);
    assert.equal(proposal.ok, true);
    if (!proposal.ok) return;
    const fingerprint = proposal.view.preview!.fingerprint;
    assert.equal(snapshotTempDirs().length, before + 1);
    service.displayed(proposal.view.runId, fingerprint, requestContext);
    const decided = await service.decide(proposal.view.runId, 'reject', fingerprint, requestContext);
    assert.equal(decided.ok, true);
    if (decided.ok) assert.equal(decided.view.state, 'REJECTED');
    // Release is initiated on rejection but not awaited by the response.
    for (let attempt = 0; attempt < 100 && snapshotTempDirs().length !== before; attempt += 1) {
      await new Promise((resolve) => { setTimeout(resolve, 50); });
    }
    assert.equal(snapshotTempDirs().length, before, 'a rejected proposal must release its snapshot');
  } finally {
    await app.close();
    await service.shutdown();
  }
});

// (9) A proposal the client never received must not remain executable.
test('a proposal aborted after preparation is released and never becomes executable', async () => {
  const workspace = makeRepo();
  const { AgentModeCommandService } = await import('../src/engine/agentModeCommandService.js');
  const { registerToolExecutionRoutes } = await import('../src/engine/toolRoutes.js');
  const { default: Fastify } = await import('fastify');
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  const resolver = new AgentRecipeResolver();
  const service = new AgentModeCommandService(toolDeps, undefined, undefined, resolver);
  const before = snapshotTempDirs().length;
  const controller = new AbortController();
  controller.abort();
  const result = await service.propose(
    { rootPath: workspace, recipe: 'git.status', reason: 'aborted before delivery' },
    { activationId: ACTIVATION, extensionProcessId: process.pid, serverInstanceId: 'brain-instance-123456789', workspaceRoot: workspace, workspaceIdentity: workspaceIdentityOf(workspace), allowedRecipes: ['git.status', 'git.diff'] },
    controller.signal,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, 'STALE');
  assert.equal(snapshotTempDirs().length, before, 'an undelivered proposal must release its snapshot');
  await app.close();
  await service.shutdown();
});

// (11) Integration acceptance fixture: small tracked repository, several hundred
// megabytes of ignored physical content, proposal well inside the extension's
// 30 second request timeout, snapshot proportional to governed material.
test('acceptance: bounded proposal over huge ignored content stays fast and proportional', async () => {
  const root = makeRepo({ ignoredBytes: 700 * 1024 * 1024, ignoredFiles: 500 });
  write(root, 'dist/bundle.js', 'x'.repeat(1024 * 1024));
  sparseFile(root, 'node_modules/.cache/blob.bin', 300 * 1024 * 1024);
  const resolver = new AgentRecipeResolver();
  const started = Date.now();
  const prepared = await resolver.prepare('git.status', root, prepareContext(root, 'agentcmd_acceptance'));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 15_000, `bounded proposal must complete well within the 30s client timeout, took ${elapsed}ms`);
  assert.ok((prepared.identity.snapshotByteCount ?? Infinity) < 8 * 1024 * 1024, `snapshot must stay proportional to governed material, got ${prepared.identity.snapshotByteCount}`);
  assert.equal(existsSync(path.join(prepared.identity.snapshotRoot, 'node_modules')), false);
  assert.equal(existsSync(path.join(prepared.identity.snapshotRoot, 'models')), false);
  assert.equal(existsSync(path.join(prepared.identity.snapshotRoot, 'dist')), false);
  assert.equal(await resolver.verify(prepared), true);
  await resolver.release(prepared);
  assert.equal(existsSync(prepared.privateRunRoot), false);
});
