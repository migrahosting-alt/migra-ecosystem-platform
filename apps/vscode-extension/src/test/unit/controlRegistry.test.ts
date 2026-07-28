import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

/**
 * The build-time registry validation, exercised by running the real script.
 *
 * These checks only make sense ACROSS declarations, so they cannot live in any one of them —
 * and a registry that tolerates a duplicate identity is worse than no registry, because
 * everything downstream trusts it to be unambiguous.
 *
 * The script is spawned rather than imported so the test covers what the build actually runs,
 * including its exit code. Each fixture is removed in a `finally`, because a stray
 * `.control.ts` would break every later run of the aggregator.
 */

const EXT_ROOT = join(__dirname, '..', '..', '..');
const SCRIPT = join(EXT_ROOT, 'scripts', 'aggregate-controls.mjs');
const FIXTURE = join(EXT_ROOT, 'src', 'interaction', '__probe.control.ts');

function aggregate(): { status: number; stderr: string; stdout: string } {
  const r = spawnSync('node', [SCRIPT], { cwd: EXT_ROOT, encoding: 'utf8' });
  return { status: r.status ?? -1, stderr: r.stderr ?? '', stdout: r.stdout ?? '' };
}

function withFixture(contents: string, assertion: (r: ReturnType<typeof aggregate>) => void): void {
  writeFileSync(FIXTURE, contents);
  try {
    assertion(aggregate());
  } finally {
    rmSync(FIXTURE, { force: true });
    // Restore the artifact, so a failing probe cannot leave a poisoned generated file behind.
    aggregate();
  }
}

test('the shipped registry validates and now holds two controls', () => {
  const r = aggregate();
  assert.equal(r.status, 0, `validation failed: ${r.stderr}`);
  assert.match(r.stdout, /2 declared, 26 known gaps of 28 contributed commands/);

  const artifact = JSON.parse(
    readFileSync(join(EXT_ROOT, 'src', 'interaction', 'generated', 'controls.generated.json'), 'utf8'),
  ) as { declarations: Array<{ controlId: string; locator: { commandId: string } }>; coverage: { knownGaps: string[] } };

  assert.deepEqual(artifact.declarations.map((d) => d.controlId).sort(), ['diagnose-failure', 'explain-selection']);
  // Two identities, two distinct exact locators — the generalisation this slice exists to prove.
  assert.equal(new Set(artifact.declarations.map((d) => d.locator.commandId)).size, 2);
  assert.ok(!artifact.coverage.knownGaps.includes('migrapilot.explainSelection'), 'the declared command left the gap list');
  assert.equal(artifact.coverage.knownGaps.length, 26);
});

test('a DUPLICATE identity is rejected', () => {
  withFixture(
    `import type { ControlDeclaration } from './types.js';
     export const probe: ControlDeclaration = {
       applicationId: 'migrapilot-vscode', surfaceId: 'engineer.command-palette',
       controlId: 'diagnose-failure', controlVersion: 1, instanceScope: 'workspace',
       consequence: 'read-only',
       locator: { adapter: 'vscode-command', commandId: 'migrapilot.probeOnly', confidence: 'exact' },
     };`,
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /duplicate identity migrapilot-vscode\/engineer\.command-palette\/diagnose-failure@v1/);
    },
  );
});

test('a DUPLICATE exact command locator is rejected', () => {
  // Two identities on one command means an invocation cannot be attributed to either.
  withFixture(
    `import type { ControlDeclaration } from './types.js';
     export const probe: ControlDeclaration = {
       applicationId: 'migrapilot-vscode', surfaceId: 'probe.surface',
       controlId: 'probe-control', controlVersion: 1, instanceScope: 'workspace',
       consequence: 'read-only',
       locator: { adapter: 'vscode-command', commandId: 'migrapilot.explainSelection', confidence: 'exact' },
     };`,
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /duplicate exact command locator "migrapilot\.explainSelection"/);
    },
  );
});

test('a MISSING consequence classification is rejected', () => {
  // An unclassified control cannot be safely scheduled: the runner would not know whether it
  // may be invoked at all.
  withFixture(
    `import type { ControlDeclaration } from './types.js';
     export const probe = {
       applicationId: 'migrapilot-vscode', surfaceId: 'probe.surface',
       controlId: 'probe-control', controlVersion: 1, instanceScope: 'workspace',
       locator: { adapter: 'vscode-command', commandId: 'migrapilot.probeOnly', confidence: 'exact' },
     };`,
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /missing consequence classification/);
    },
  );
});

test('a MALFORMED version is rejected', () => {
  withFixture(
    `import type { ControlDeclaration } from './types.js';
     export const probe = {
       applicationId: 'migrapilot-vscode', surfaceId: 'probe.surface',
       controlId: 'probe-control', controlVersion: 0, instanceScope: 'workspace',
       consequence: 'read-only',
       locator: { adapter: 'vscode-command', commandId: 'migrapilot.probeOnly', confidence: 'exact' },
     };`,
    (r) => {
      assert.equal(r.status, 1);
      assert.match(r.stderr, /controlVersion must be a positive integer/);
    },
  );
});

test('a STALE gap entry for a removed command is rejected', () => {
  // Bookkeeping that outlives its subject is how a coverage list stops describing reality.
  const script = readFileSync(SCRIPT, 'utf8');
  const patched = script.replace(
    'const UNDECLARED_COMMANDS = new Set([',
    "const UNDECLARED_COMMANDS = new Set([\n  'migrapilot.commandThatNoLongerExists',",
  );
  const tmp = join(EXT_ROOT, 'scripts', '__probe-aggregate.mjs');
  writeFileSync(tmp, patched);
  try {
    const r = spawnSync('node', [tmp], { cwd: EXT_ROOT, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr ?? '', /no longer a contributed command/);
  } finally {
    rmSync(tmp, { force: true });
  }
});

test('the generated artifact is derived evidence, and says so', () => {
  const artifact = JSON.parse(
    readFileSync(join(EXT_ROOT, 'src', 'interaction', 'generated', 'controls.generated.json'), 'utf8'),
  ) as { generated: string };
  assert.match(artifact.generated, /DERIVED EVIDENCE, do not edit/);
  assert.ok(existsSync(SCRIPT), 'the generator that owns it must exist');
});
