import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const fullSha = /^[a-f0-9]{40}$/;
const releaseName = /^(?!\.)(?!.*\.\.)[A-Za-z0-9._-]+$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));
const git = (root, args) => execFileSync('git', args, {
  cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
});

function assertSource(root, commit) {
  assert.match(commit, fullSha, 'expected commit must be a full lowercase SHA');
  assert.equal(realpathSync(git(root, ['rev-parse', '--show-toplevel']).trim()), realpathSync(root),
    'source root must be the repository root');
  assert.equal(git(root, ['rev-parse', 'HEAD']).trim(), commit, 'source HEAD moved from the pinned commit');
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  assert.ok(!dirty, 'source tree/index has uncommitted or untracked changes; use a clean isolated checkout');
  const ignored = git(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z', '--',
    'apps/brain-service/src', 'apps/brain-service/test',
    ':(glob)packages/*/src/**', ':(glob)packages/*/test/**',
  ]).split('\0').filter((file) => /\.(?:tsx?|jsx?|mjs|cjs|json|sql|wasm)$/.test(file));
  assert.deepEqual(ignored, [], 'required source is ignored by Git; correct the allowlist before releasing');
}

function assertGovernance(root) {
  const service = json(join(root, 'docs/governance/governance-status.json')).services?.migrapilot_brain;
  assert.ok(service, 'Brain has no service-specific governance clearance');
  assert.equal(service.article_iv, 'COMPLIANT', 'Brain Article IV is not COMPLIANT; normal production release is frozen');
  assert.equal(service.normal_deploys_blocked, false, 'Brain normal production releases are blocked or unknown');
}

function assertCanonical(root, commit) {
  assertSource(root, commit);
  const repository = 'repos/Migrateck-Ecosystem/migra-ecosystem-platform';
  const api = (resource, selector) => execFileSync('gh', ['api', resource, '--jq', selector], { encoding: 'utf8' }).trim();
  const branch = api(repository, '.default_branch');
  assert.ok(branch && branch !== 'null', 'canonical branch is unknown');
  const tip = api(`${repository}/branches/${encodeURIComponent(branch)}`, '.commit.sha');
  assert.match(tip, fullSha, 'canonical tip is unknown');
  const status = api(`${repository}/compare/${commit}...${tip}`, '.status');
  assert.ok(['ahead', 'identical'].includes(status), 'release commit is not in current canonical branch history');
}

function treeDigest(directory) {
  const entries = [];
  function walk(dir, relative = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), name);
      else if (entry.isFile() && entry.name !== 'RELEASE.json') {
        entries.push([name, hash(readFileSync(join(dir, entry.name)))]);
      } else if (!entry.isFile()) {
        throw new Error(`build output is not a regular file/directory: ${name}`);
      }
    }
  }
  walk(directory);
  assert.ok(entries.length, `build output is empty: ${directory}`);
  entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  return hash(JSON.stringify(entries));
}

function artifactDigests(root) {
  const manifest = json(join(root, 'apps/brain-service/package.json'));
  const workspaceBuildIds = {};
  for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
    if (!dependency.startsWith('@migrapilot/')) continue;
    const name = dependency.slice('@migrapilot/'.length);
    assert.match(name, /^[a-z0-9-]+$/, 'unsupported workspace dependency name');
    const directory = join(root, 'packages', name);
    const packageFile = join(directory, 'package.json');
    assert.equal(json(packageFile).name, dependency, 'workspace package identity mismatch');
    workspaceBuildIds[dependency] = hash(JSON.stringify([
      hash(readFileSync(packageFile)), treeDigest(join(directory, 'dist')),
    ]));
  }
  const lockfileSha256 = hash(readFileSync(join(root, 'package-lock.json')));
  const governanceSha256 = hash(readFileSync(join(root, 'docs/governance/governance-status.json')));
  const targetContractSha256 = hash(readFileSync(join(root, 'docs/migrapilot/deploy-targets.sh')));
  const buildId = 'sha256:' + hash(JSON.stringify({
    brain: treeDigest(join(root, 'apps/brain-service/dist')),
    brainManifest: hash(readFileSync(join(root, 'apps/brain-service/package.json'))),
    rootManifest: hash(readFileSync(join(root, 'package.json'))),
    lockfileSha256, workspaceBuildIds, governanceSha256, targetContractSha256,
  })).slice(0, 40);
  return { buildId, lockfileSha256, workspaceBuildIds, governanceSha256, targetContractSha256 };
}

function readStamp(file) {
  const stamp = json(file);
  assert.ok(stamp && typeof stamp === 'object' && !Array.isArray(stamp), 'release stamp must be an object');
  assert.match(stamp.commit, fullSha, 'release stamp needs a full commit SHA');
  assert.match(stamp.release, releaseName, 'invalid stamped release name');
  assert.match(stamp.buildId, /^sha256:[a-f0-9]{40}$/, 'invalid stamped build identity');
  assert.ok(typeof stamp.builtAt === 'string' && Number.isFinite(Date.parse(stamp.builtAt)), 'invalid stamp time');
  return stamp;
}

function stampArtifact(root, commit, release) {
  assert.match(release, releaseName, 'invalid release name');
  assertSource(root, commit);
  const stamp = { commit, release, ...artifactDigests(root), builtAt: new Date().toISOString() };
  assertSource(root, commit);
  writeFileSync(join(root, 'apps/brain-service/dist/RELEASE.json'), JSON.stringify(stamp) + '\n');
  console.log(stamp.buildId);
}

function assertArtifact(root, release) {
  const stamp = readStamp(join(root, 'apps/brain-service/dist/RELEASE.json'));
  assert.equal(stamp.release, release, 'payload stamp names a different release');
  const actual = artifactDigests(root);
  for (const field of ['buildId', 'lockfileSha256', 'workspaceBuildIds', 'governanceSha256', 'targetContractSha256']) {
    assert.deepEqual(stamp[field], actual[field], `payload ${field} differs from the stamped artifact`);
  }
}

function assertSchema(built) {
  assert.match(built, /^\d+$/, 'built schema version is unknown');
  const health = JSON.parse(readFileSync(0, 'utf8'));
  const versions = [...JSON.stringify(health).matchAll(/"schemaVersion":(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(versions.length && versions.every((v) => v === versions[0]), 'live schema version is unknown or ambiguous');
  const live = versions[0];
  assert.ok(Number(built) >= live, `schema downgrade refused: built ${built}, live ${live}`);
  if (Number(built) > live) {
    assert.equal(process.env.MIGRAPILOT_ALLOW_MIGRATIONS, '1',
      `boot would migrate the REAL database from ${live} to ${built}; separate database approval and MIGRAPILOT_ALLOW_MIGRATIONS=1 are required`);
    console.error(`MIGRAPILOT_ALLOW_MIGRATIONS=1: schema ${live} -> ${built}; rollback will be CODE-ONLY`);
  }
}

function assertInheritedDependencies(lockfile) {
  const stamp = JSON.parse(readFileSync(0, 'utf8'));
  assert.equal(stamp?.lockfileSha256, hash(readFileSync(lockfile)),
    'inherited dependency lock is missing or differs; use the hardened exact-lockfile release path');
}

function assertRunning(stampFile) {
  const expected = readStamp(stampFile);
  const actual = JSON.parse(readFileSync(0, 'utf8'));
  assert.equal(actual.stamped, true, 'running process is not stamped');
  for (const field of ['commit', 'release', 'buildId', 'builtAt']) {
    assert.equal(actual[field], expected[field], `running process reports a different ${field}`);
  }
}

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'source' && args.length === 2) assertSource(...args);
  else if (mode === 'governance' && args.length === 1) assertGovernance(...args);
  else if (mode === 'canonical' && args.length === 2) assertCanonical(...args);
  else if (mode === 'stamp' && args.length === 3) stampArtifact(...args);
  else if (mode === 'artifact' && args.length === 2) assertArtifact(...args);
  else if (mode === 'verify' && args.length === 1) assertRunning(...args);
  else if (mode === 'schema' && args.length === 1) assertSchema(...args);
  else if (mode === 'dependencies' && args.length === 1) assertInheritedDependencies(...args);
  else throw new Error('usage: brain-release-gate.mjs source|canonical <root> <sha> | governance <root> | stamp <root> <sha> <release> | artifact <payload-root> <release> | verify <stamp-file> (version JSON on stdin) | schema <built-version> (health JSON on stdin)');
} catch (error) {
  console.error('Brain release gate refused:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
