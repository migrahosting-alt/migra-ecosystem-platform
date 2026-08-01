import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { TEST_BRAIN_OWNER_ENV, killStaleBrains, markTestBrainOwnership } from './support/staleBrains.js';
import { runFixtureTests, writeCodingFixture } from './support/codingFixture.js';

// See runTest.ts — strip the parent extension host's env so the child VS Code
// launches as a real editor rather than plain Node.
function cleanElectronEnv(): void {
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
}

function findLocalVSCode(extensionRoot: string): string | undefined {
  const base = path.join(extensionRoot, '.vscode-test');
  if (!fs.existsSync(base)) return undefined;
  const dir = fs.readdirSync(base).find((n) => n.startsWith('vscode-'));
  if (!dir) return undefined;
  const candidate = path.join(base, dir, 'code');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function makeFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrapilot-vsix-'));
  fs.writeFileSync(
    path.join(root, 'sample.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
  );
  const git = (args: string[]) => spawnSync('git', args, { cwd: root });
  git(['init', '-q']);
  git(['config', 'user.email', 'e2e@migrapilot.test']);
  git(['config', 'user.name', 'e2e']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);
  fs.appendFileSync(path.join(root, 'sample.ts'), '\nexport const version = 1;\n');

  // The governed-coding fixture lives in the SAME workspace, because VS Code opens
  // exactly one and the command deliberately refuses a multi-root workspace. It is
  // committed here so the tree the coding acceptance inherits is CLEAN — a
  // pre-existing dirty file would be reconciled as a write outside the approved
  // scope, which is the rule working, not a fixture we may ignore.
  writeCodingFixture(root);
  // The launcher puts VS Code's user-data-dir INSIDE this workspace, and it churns
  // constantly. Ignoring it keeps `git status` a statement about repository
  // content — which is what reconciliation compares the approved scope against.
  fs.writeFileSync(path.join(root, '.gitignore'), '.vscode-user/\n');
  git(['add', '-A']);
  git(['commit', '-qm', 'coding fixture']);
  return root;
}

function packageVsix(extensionRoot: string): string {
  const vsce = path.resolve(extensionRoot, '../../node_modules/@vscode/vsce/vsce');
  const out = path.join(extensionRoot, 'migrapilot-extension-e2e.vsix');
  fs.rmSync(out, { force: true });
  const res = spawnSync(
    'node',
    [vsce, 'package', '--no-dependencies', '--allow-missing-repository', '--skip-license', '-o', out],
    { cwd: extensionRoot, stdio: 'inherit' },
  );
  if (res.status !== 0 || !fs.existsSync(out)) {
    throw new Error('vsce package failed');
  }
  return out;
}

// Unzip the VSIX and return the packaged extension root (the `extension/`
// payload: the shipped package.json + dist, with src/ and dist/test excluded
// by .vscodeignore). Loading THIS as the extension-under-test validates the
// exact artifact a user would install — if .vscodeignore dropped a needed
// runtime file, activation fails here.
function extractPackagedExtension(vsix: string): string {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'migrapilot-vsix-unzip-'));
  const unzip = spawnSync('unzip', ['-q', '-o', vsix, '-d', staging], { stdio: 'inherit' });
  if (unzip.status !== 0) {
    throw new Error(`unzip of VSIX failed with code ${unzip.status}`);
  }
  const extRoot = path.join(staging, 'extension');
  if (!fs.existsSync(path.join(extRoot, 'package.json'))) {
    throw new Error('packaged extension payload missing package.json');
  }
  return extRoot;
}

async function main(): Promise<void> {
  cleanElectronEnv();
  // Stamp ownership FIRST: every brain this run starts (harness or extension,
  // which inherits process.env) carries the marker, so the sweep can tell them
  // apart from a developer's pre-existing brain on the same port.
  const brainOwnerToken = markTestBrainOwnership();
  killStaleBrains(); // deterministic: a prior interrupted run can't contaminate this gate
  const extensionRoot = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
  const vscodeExecutablePath = findLocalVSCode(extensionRoot);
  if (!vscodeExecutablePath) {
    throw new Error('local VS Code build not found under .vscode-test');
  }

  const workspace = makeFixtureWorkspace();

  // Verify the fixture BASELINE before anything activates. Measuring a damaged
  // fixture would produce an acceptance result about the wrong repository, so a
  // baseline that is not exactly five genuine failures aborts the gate.
  const baseline = runFixtureTests(workspace);
  if (baseline.exitCode === 0 || baseline.failed !== 5) {
    throw new Error(
      `coding fixture baseline is not the expected 5 failures (exit ${baseline.exitCode}, pass ${baseline.passed}, fail ${baseline.failed}) — refusing to run acceptance against a damaged fixture`,
    );
  }
  console.log(`coding fixture baseline: exit ${baseline.exitCode}, ${baseline.passed} pass, ${baseline.failed} fail`);

  // Real durable state. `off` would leave the coding capability correctly
  // unavailable, so an acceptance run against it would prove nothing.
  const codingDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migrapilot-vsix-db-')), 'engine.db');
  let packagedRoot: string | undefined;

  try {
    const vsix = packageVsix(extensionRoot);
    packagedRoot = extractPackagedExtension(vsix);

    // extensionDevelopmentPath points at the PACKAGED payload, not the source
    // tree — so the same suite runs against the shipped package.json + dist.
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: packagedRoot,
      extensionTestsPath,
      launchArgs: [
        workspace,
        '--disable-extensions',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-workspace-trust',
        `--user-data-dir=${path.join(workspace, '.vscode-user')}`,
      ],
      extensionTestsEnv: {
        [TEST_BRAIN_OWNER_ENV]: brainOwnerToken,
        MIGRAPILOT_E2E_WORKSPACE: workspace,
        MIGRAPILOT_STATE_DB: 'off',
        MIGRAPILOT_TEST_MODE: 'vsix',
        // Governed coding acceptance. The suite spawns its OWN brain with these,
        // so the shared DB-free brain above stays untouched.
        MIGRAPILOT_CODING_E2E_DB: codingDb,
        MIGRAPILOT_CODING_E2E_ROOT: workspace,
      },
    });
  } catch (err) {
    console.error('Packaged-VSIX integration tests failed:', err);
    process.exit(1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    if (packagedRoot) {
      fs.rmSync(path.dirname(packagedRoot), { recursive: true, force: true });
    }
    killStaleBrains(); // sweep any brain a crashed host left behind
  }
}

void main();
