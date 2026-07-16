import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { killStaleBrains } from './support/staleBrains.js';

// Dedicated launcher for the P6 operational-validation matrix. Reuses the same
// harness pattern as runTest.ts but runs ONLY the ops suite (in isolation) and
// passes the evidence output directory through to the Extension Host.

function findLocalVSCode(extensionRoot: string): string | undefined {
  const base = path.join(extensionRoot, '.vscode-test');
  if (!fs.existsSync(base)) return undefined;
  const dir = fs.readdirSync(base).find((n) => n.startsWith('vscode-'));
  if (!dir) return undefined;
  const candidate = path.join(base, dir, 'code');
  return fs.existsSync(candidate) ? candidate : undefined;
}

function makeFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrapilot-ops-'));
  fs.writeFileSync(path.join(root, 'sample.ts'), 'export const a = 1;\n');
  const git = (args: string[]) => spawnSync('git', args, { cwd: root });
  git(['init', '-q']);
  git(['config', 'user.email', 'ops@migrapilot.test']);
  git(['config', 'user.name', 'ops']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);
  return root;
}

function cleanElectronEnv(): void {
  delete process.env.ELECTRON_RUN_AS_NODE;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('VSCODE_')) {
      delete process.env[key];
    }
  }
}

async function main(): Promise<void> {
  cleanElectronEnv();
  killStaleBrains();
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/opsIndex.js');
  const workspace = makeFixtureWorkspace();
  const vscodeExecutablePath = findLocalVSCode(extensionDevelopmentPath);

  const evidenceDir = process.env.MIGRAPILOT_EVIDENCE_DIR ?? path.join(os.tmpdir(), 'migrapilot-p6-evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });

  try {
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath,
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
        MIGRAPILOT_E2E_WORKSPACE: workspace,
        MIGRAPILOT_EVIDENCE_DIR: evidenceDir,
      },
    });
  } catch (err) {
    console.error('Ops validation failed:', err);
    process.exit(1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    killStaleBrains();
  }
}

void main();
