import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';

let root = process.cwd();
while (!existsSync(join(root, '.git'))) {
  const parent = dirname(root);
  if (parent === root) throw new Error('repository root not found');
  root = parent;
}
const gate = join(root, 'scripts/brain-release-gate.mjs');
const packages = ['protocol', 'shared-types', 'pilot-client', 'agent-defs', 'workspace-tools'];
const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', MIGRAPILOT_ALLOW_MIGRATIONS: '0' };

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'brain-release-gate-'));
  const repo = join(directory, 'repo');
  mkdirSync(repo);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const write = (file: string, content: string) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    writeFileSync(join(repo, file), content);
  };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  write('.gitignore', 'apps/brain-service/dist/\npackages/*/dist/\nignored-required.ts\n');
  write('package.json', '{"private":true}\n');
  write('package-lock.json', '{"lockfileVersion":3}\n');
  write('apps/brain-service/package.json', JSON.stringify({
    name: '@migrapilot/brain-service', type: 'module',
    dependencies: Object.fromEntries(packages.map((p) => [`@migrapilot/${p}`, '0.1.0'])),
  }));
  write('apps/brain-service/src/server.ts', 'export const ready = true;\n');
  write('apps/brain-service/dist/src/server.js', 'export const ready = true;\n');
  write('docs/governance/governance-status.json', JSON.stringify({
    deployment_freeze: { active: true }, services: { migrapilot_brain: { article_iv: 'COMPLIANT', normal_deploys_blocked: false } },
  }));
  write('docs/migrapilot/deploy-targets.sh', '# fixture target contract\n');
  for (const p of packages) {
    write(`packages/${p}/package.json`, JSON.stringify({ name: `@migrapilot/${p}`, version: '0.1.0' }));
    write(`packages/${p}/dist/index.js`, 'export const ready = true;\n');
  }
  mkdirSync(join(repo, 'scripts'));
  copyFileSync(gate, join(repo, 'scripts/brain-release-gate.mjs'));
  copyFileSync(join(root, 'scripts/build-brain-payload.sh'), join(repo, 'scripts/build-brain-payload.sh'));
  git('init', '-q');
  git('config', 'user.name', 'Release gate fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'Fixture\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
  const sha = git('rev-parse', 'HEAD');
  const run = (mode: string, ...args: string[]) => spawnSync(process.execPath, [gate, mode, ...args], { env, encoding: 'utf8' });
  const stamp = () => {
    const result = run('stamp', repo, sha, 'brain-fixture');
    assert.equal(result.status, 0, result.stderr);
    return join(repo, 'apps/brain-service/dist/RELEASE.json');
  };
  return { directory, repo, write, git, sha, run, stamp };
}

test('clean committed source passes with ignored build output present', (t) => {
  const f = fixture(t);
  assert.equal(f.run('source', f.repo, f.sha).status, 0);
});

for (const mutation of ['unstaged', 'staged', 'untracked-brain', 'untracked-package', 'root-lock', 'ignored-source', 'head-moved']) {
  test(`source gate refuses ${mutation} without changing source`, (t) => {
    const f = fixture(t);
    if (mutation === 'unstaged' || mutation === 'staged') {
      f.write('apps/brain-service/src/server.ts', 'export const ready = false;\n');
      if (mutation === 'staged') f.git('add', 'apps/brain-service/src/server.ts');
    } else if (mutation === 'untracked-brain') f.write('apps/brain-service/src/forgotten.ts', 'export {};\n');
    else if (mutation === 'untracked-package') f.write('packages/workspace-tools/src/forgotten.ts', 'export {};\n');
    else if (mutation === 'root-lock') f.write('package-lock.json', '{}\n');
    else if (mutation === 'ignored-source') f.write('apps/brain-service/src/ignored-required.ts', 'export {};\n');
    else f.git('commit', '--allow-empty', '-qm', 'Moved HEAD\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
    const before = f.git('status', '--porcelain');
    const result = f.run('source', f.repo, f.sha);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /uncommitted|ignored|HEAD moved/);
    assert.equal(f.git('status', '--porcelain'), before);
  });
}

test('unknown SHA, root and Git metadata refuse instead of inventing identity', (t) => {
  const f = fixture(t);
  assert.notEqual(f.run('source', f.repo, f.sha.slice(0, 8)).status, 0);
  assert.notEqual(f.run('source', join(f.repo, 'apps/brain-service'), f.sha).status, 0);
  assert.notEqual(f.run('source', f.directory, f.sha).status, 0);
});

test('production clearance is explicit, service-specific and fail-closed', (t) => {
  const f = fixture(t);
  assert.equal(f.run('governance', f.repo).status, 0, 'global freeze must not override an explicitly compliant service');
  for (const service of [undefined, { article_iv: 'NON_COMPLIANT', normal_deploys_blocked: true },
    { article_iv: 'COMPLIANT' }, { article_iv: 'COMPLIANT', normal_deploys_blocked: true }]) {
    f.write('docs/governance/governance-status.json', JSON.stringify({
      services: { migrapilot_brain: service, migrapilot_consumer: { article_iv: 'COMPLIANT', normal_deploys_blocked: false } },
    }));
    assert.notEqual(f.run('governance', f.repo).status, 0);
  }
  f.write('docs/governance/governance-status.json', '{ broken');
  assert.notEqual(f.run('governance', f.repo).status, 0);
});

test('manual canonical membership uses an exact current tip and never legacy local main', (t) => {
  const f = fixture(t);
  const bin = join(f.directory, 'github-mock');
  mkdirSync(bin);
  const script = join(bin, 'gh');
  writeFileSync(script, `#!/usr/bin/env bash
set -euo pipefail
case "$2" in
  repos/Migrateck-Ecosystem/migra-ecosystem-platform) printf '%s\\n' "$FIXTURE_BRANCH" ;;
  */branches/auth%2Fcanonical) printf '%s\\n' "$FIXTURE_TIP" ;;
  */compare/${f.sha}...${f.sha}) printf '%s\\n' "$FIXTURE_COMPARISON" ;;
  *) printf 'unexpected canonical query\\n' >&2; exit 1 ;;
esac
`);
  chmodSync(script, 0o755);
  const run = (comparison: string, branch = 'auth/canonical', tip = f.sha) => spawnSync(process.execPath, [gate, 'canonical', f.repo, f.sha], {
    env: { ...env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_COMPARISON: comparison, FIXTURE_BRANCH: branch, FIXTURE_TIP: tip },
    encoding: 'utf8',
  });
  for (const comparison of ['ahead', 'identical']) assert.equal(run(comparison).status, 0);
  for (const comparison of ['behind', 'diverged', 'unknown']) assert.notEqual(run(comparison).status, 0);
  assert.notEqual(run('ahead', 'null').status, 0);
  assert.notEqual(run('ahead', 'auth/canonical', 'unknown').status, 0);
});

test('stamp pins commit, lock, target/governance and every runtime workspace', (t) => {
  const f = fixture(t);
  const file = f.stamp();
  const identity = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  assert.equal(identity.commit, f.sha);
  assert.equal(identity.release, 'brain-fixture');
  assert.match(String(identity.buildId), /^sha256:[a-f0-9]{40}$/);
  assert.match(String(identity.lockfileSha256), /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(identity.workspaceBuildIds as object).sort(), packages.map((p) => `@migrapilot/${p}`).sort());
  assert.equal(f.run('artifact', f.repo, 'brain-fixture').status, 0);
  assert.notEqual(f.run('artifact', f.repo, 'other-release').status, 0);
  f.write('packages/workspace-tools/dist/index.js', 'export const ready = false;\n');
  const changed = f.run('artifact', f.repo, 'brain-fixture');
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /differs from the stamped artifact/);
});

test('stamp refuses unsafe names and does not fabricate missing build output', (t) => {
  const f = fixture(t);
  for (const name of ['../live', '.hidden', 'brain..next', 'brain/next']) {
    assert.notEqual(f.run('stamp', f.repo, f.sha, name).status, 0);
  }
  rmSync(join(f.repo, 'packages/protocol/dist/index.js'));
  assert.notEqual(f.run('stamp', f.repo, f.sha, 'brain-fixture').status, 0);
  assert.equal(existsSync(join(f.repo, 'apps/brain-service/dist/RELEASE.json')), false);
});

test('running identity verifies parsed top-level JSON and refuses each mismatch', (t) => {
  const f = fixture(t);
  const file = f.stamp();
  const expected = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const run = (input: string) => spawnSync(process.execPath, [gate, 'verify', file], { env, input, encoding: 'utf8' });
  assert.equal(run(JSON.stringify({ ...expected, stamped: true }, null, 2)).status, 0);
  for (const field of ['commit', 'release', 'buildId', 'builtAt', 'stamped']) {
    assert.notEqual(run(JSON.stringify({ ...expected, stamped: true, [field]: field === 'stamped' ? false : 'wrong' })).status, 0);
  }
  assert.notEqual(run(JSON.stringify({ old: { ...expected, stamped: true }, stamped: true })).status, 0);
  assert.notEqual(run('{broken').status, 0);
  assert.notEqual(run('').status, 0);
});

test('schema gate refuses unknown, ambiguous, downgrade and unapproved migrations', () => {
  const run = (built: string, health: unknown, allow = '0') => spawnSync(process.execPath, [gate, 'schema', built], {
    env: { ...env, MIGRAPILOT_ALLOW_MIGRATIONS: allow }, input: JSON.stringify(health), encoding: 'utf8',
  });
  assert.equal(run('7', { persistence: { schemaVersion: 7 } }).status, 0);
  for (const [built, health] of [
    ['unknown', { schemaVersion: 7 }], ['7', {}], ['6', { schemaVersion: 7 }],
    ['8', { schemaVersion: 7 }], ['7', { schemaVersion: 7, other: { schemaVersion: 6 } }],
  ] as const) assert.notEqual(run(built, health).status, 0);
  const approved = run('8', { schemaVersion: 7 }, '1');
  assert.equal(approved.status, 0);
  assert.match(approved.stderr, /rollback will be CODE-ONLY/);
  assert.notEqual(run('6', { schemaVersion: 7 }, '1').status, 0, 'migration opt-in must not permit downgrades');
  assert.notEqual(run('8', {}, '1').status, 0, 'migration opt-in must not guess live schema');
});

test('manual inherited dependencies require the exact measured lock, never legacy guesses', (t) => {
  const f = fixture(t);
  const file = f.stamp();
  const run = (input: string) => spawnSync(process.execPath, [gate, 'dependencies', join(f.repo, 'package-lock.json')], {
    env, input, encoding: 'utf8',
  });
  const stamp = readFileSync(file, 'utf8');
  assert.equal(run(stamp).status, 0);
  for (const input of ['', '{broken', '{}', 'null', '{"lockfileSha256":"different"}']) {
    assert.notEqual(run(input).status, 0);
  }
  f.write('package-lock.json', '{"lockfileVersion":3,"changed":true}\n');
  assert.notEqual(run(stamp).status, 0);
});

test('real payload builder stamps exact identity and refuses dirty or wrong-HEAD source', (t) => {
  const f = fixture(t);
  const output = join(f.directory, 'payload.tgz');
  const build = (sha = f.sha) => spawnSync('bash', [
    join(f.repo, 'scripts/build-brain-payload.sh'), output, sha, 'brain-fixture',
  ], { env, encoding: 'utf8' });
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  const archiveStamp = JSON.parse(execFileSync('tar', ['-xOf', output, 'apps/brain-service/dist/RELEASE.json'], { encoding: 'utf8' })) as Record<string, unknown>;
  assert.equal(archiveStamp.commit, f.sha);
  assert.equal(archiveStamp.release, 'brain-fixture');
  const unpacked = join(f.directory, 'unpacked');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xzf', output, '-C', unpacked]);
  assert.equal(f.run('artifact', unpacked, 'brain-fixture').status, 0);
  const before = readFileSync(output);
  assert.notEqual(build('0'.repeat(40)).status, 0);
  f.write('packages/workspace-tools/src/forgotten.ts', 'export {};\n');
  assert.notEqual(build().status, 0);
  assert.deepEqual(readFileSync(output), before, 'refused build must not replace a qualified payload');
});

for (const scenario of ['success', 'wrong-boot', 'wrong-live', 'restart-failed', 'frozen', 'migration', 'incomplete-rollback']) {
  test(`isolated hardened release ${scenario}: exact identity, freeze and rollback behavior`, (t) => {
    const f = fixture(t);
    const appRoot = join(f.directory, 'brain');
    const old = join(appRoot, 'releases/old-fixture');
    const release = join(appRoot, 'releases/brain-fixture');
    const bin = join(f.directory, 'bin');
    mkdirSync(bin);
    const installed = join(f.directory, 'installed');
    mkdirSync(installed);
    copyFileSync(gate, join(installed, 'brain-release-gate.mjs'));
    copyFileSync(join(root, 'scripts/release-completeness.sh'), join(installed, 'release-completeness.sh'));
    const script = readFileSync(join(root, 'scripts/brain-release.sh'), 'utf8');
    assert.ok(script.includes('APP_ROOT=/opt/migrapilot/brain-service'));
    writeFileSync(join(installed, 'brain-release.sh'), script.replace('APP_ROOT=/opt/migrapilot/brain-service', `APP_ROOT="${appRoot}"`));
    f.write('docs/migrapilot/deploy-targets.sh', `
deploy_target() {
  [ "$1" = production ] || return 1
  DEPLOY_BRAIN_ROOT="${appRoot}"
  DEPLOY_BRAIN_UNIT=migrapilot-brain.service
  DEPLOY_SERVICE_USER=fixture-user
  DEPLOY_SERVICE_GROUP=fixture-user
  DEPLOY_ENV_FILES="/fixture.env -/optional.env"
}
env_file_properties() { printf '%s' '--property=EnvironmentFile=/fixture.env --property=EnvironmentFile=-/optional.env'; }
`);
    f.write('apps/brain-service/dist/src/engine/persistence/postgres/migrations.js', 'export const latestVersion = () => 7;\n');
    if (scenario === 'frozen') f.write('docs/governance/governance-status.json',
      '{"services":{"migrapilot_brain":{"article_iv":"NON_COMPLIANT","normal_deploys_blocked":true}}}\n');
    f.git('add', 'docs');
    f.git('commit', '-qm', 'Harness target\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>');
    const sha = f.git('rev-parse', 'HEAD');
    const stamped = f.run('stamp', f.repo, sha, 'brain-fixture');
    assert.equal(stamped.status, 0, stamped.stderr);
    const stamp = JSON.parse(readFileSync(join(f.repo, 'apps/brain-service/dist/RELEASE.json'), 'utf8')) as Record<string, unknown>;
    mkdirSync(join(old, 'dist/src'), { recursive: true });
    mkdirSync(join(old, 'node_modules'));
    writeFileSync(join(old, 'package.json'), '{}');
    if (scenario !== 'incomplete-rollback') writeFileSync(join(old, 'dist/src/server.js'), '// old fixture\n');
    writeFileSync(join(old, 'dist/RELEASE.json'), JSON.stringify({ ...stamp, release: 'old-fixture' }));
    symlinkSync(old, join(appRoot, 'current'));
    symlinkSync(old, join(appRoot, 'previous'));
    const payload = join(f.directory, 'payload.tgz');
    const build = spawnSync('bash', [join(f.repo, 'scripts/build-brain-payload.sh'), payload, sha, 'brain-fixture'], { env, encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const mock = (name: string, contents: string) => {
      writeFileSync(join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${contents}\n`);
      chmodSync(join(bin, name), 0o755);
    };
    mock('df', `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfixture 209715200 1 209715199 1%% /\\n'`);
    mock('sleep', ':');
    mock('npm', `
printf 'npm\\n' >> "$FIXTURE_OPERATIONS"
mkdir -p node_modules/@migrapilot
for package in protocol shared-types pilot-client agent-defs workspace-tools; do
  cp -R "packages/$package" "node_modules/@migrapilot/$package"
done
`);
    mock('systemd-run', 'printf "boot %s\\n" "$*" >> "$FIXTURE_OPERATIONS"');
    mock('systemctl', `
printf 'systemctl %s\\n' "$*" >> "$FIXTURE_OPERATIONS"
if [ "$1" = show ]; then printf 'fixture-user\\n'; fi
if [ "$1" = restart ] && [ "$FIXTURE_SCENARIO" = restart-failed ] && [ "$(readlink "$FIXTURE_APP_ROOT/current")" = "$FIXTURE_RELEASE" ]; then exit 1; fi
`);
    mock('curl', `
url="\${@: -1}"
case "$url" in
  */health)
    version=7
    [ "$FIXTURE_SCENARIO" != migration ] || version=6
    printf '{"status":"ok","persistence":{"schemaVersion":%s}}\\n' "$version"
    ;;
  */api/version)
    stamp="$FIXTURE_RELEASE/dist/RELEASE.json"
    if [[ "$url" == *:3991/* && "$FIXTURE_SCENARIO" = wrong-boot ]] || [[ "$url" == *:3988/* && "$FIXTURE_SCENARIO" = wrong-live ]]; then
      stamp="$FIXTURE_OLD/dist/RELEASE.json"
    fi
    node -e 'const fs=require("node:fs");console.log(JSON.stringify({...JSON.parse(fs.readFileSync(process.argv[1],"utf8")),stamped:true}));' "$stamp"
    ;;
  *) printf 'unexpected mock curl URL\\n' >&2; exit 2 ;;
esac
`);
    const operations = join(f.directory, 'operations');
    writeFileSync(operations, '');
    const result = spawnSync('bash', [join(installed, 'brain-release.sh'), '--payload', payload, '--name', 'brain-fixture', '--activate'], {
      env: { ...env, PATH: `${bin}:${process.env.PATH}`, FIXTURE_SCENARIO: scenario, FIXTURE_APP_ROOT: appRoot,
        FIXTURE_RELEASE: release, FIXTURE_OLD: old, FIXTURE_OPERATIONS: operations },
      encoding: 'utf8',
    });
    const calls = readFileSync(operations, 'utf8');
    assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stdout + result.stderr);
    assert.equal(readlinkSync(join(appRoot, 'current')), scenario === 'success' ? release : old);
    assert.equal(readlinkSync(join(appRoot, 'previous')), old);
    if (scenario === 'success') {
      assert.match(calls, /--property=User=fixture-user/);
      assert.match(calls, /--property=EnvironmentFile=-\/optional.env/);
      assert.match(calls, /systemctl stop brain-boottest-brain-fixture/);
    }
    if (['frozen', 'incomplete-rollback'].includes(scenario)) assert.doesNotMatch(calls, /npm/);
    if (['frozen', 'migration', 'incomplete-rollback'].includes(scenario)) assert.doesNotMatch(calls, /boot /);
    if (['wrong-boot', 'frozen', 'migration', 'incomplete-rollback'].includes(scenario)) assert.doesNotMatch(calls, /systemctl restart/);
    if (['wrong-live', 'restart-failed'].includes(scenario)) assert.match(result.stderr, /rolling back/);
  });
}
