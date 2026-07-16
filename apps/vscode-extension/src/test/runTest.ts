import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';
import { killStaleBrains } from './support/staleBrains.js';

// Reuse the already-downloaded VS Code build instead of fetching one.
function findLocalVSCode(extensionRoot: string): string | undefined {
  const base = path.join(extensionRoot, '.vscode-test');
  if (!fs.existsSync(base)) {
    return undefined;
  }
  const dir = fs
    .readdirSync(base)
    .find((name) => name.startsWith('vscode-linux') || name.startsWith('vscode-'));
  if (!dir) {
    return undefined;
  }
  const candidate = path.join(base, dir, 'code');
  return fs.existsSync(candidate) ? candidate : undefined;
}

// A throwaway git repo so git.status / git.diff and workspace features work.
function makeFixtureWorkspace(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'migrapilot-e2e-'));
  fs.writeFileSync(
    path.join(root, 'sample.ts'),
    [
      'export function add(a: number, b: number): number {',
      '  return a + b;',
      '}',
      '',
      'export function greet(name: string): string {',
      '  return `hello ${name}`;',
      '}',
      '',
    ].join('\n'),
  );
  const git = (args: string[]) => spawnSync('git', args, { cwd: root });
  git(['init', '-q']);
  git(['config', 'user.email', 'e2e@migrapilot.test']);
  git(['config', 'user.name', 'e2e']);
  git(['add', '-A']);
  git(['commit', '-qm', 'fixture']);
  // Leave an uncommitted change so git.diff has content.
  fs.appendFileSync(path.join(root, 'sample.ts'), '\nexport const version = 1;\n');
  return root;
}

// This launcher itself runs inside a VS Code extension host, which exports
// ELECTRON_RUN_AS_NODE=1 and VSCODE_* vars. If inherited by the child VS Code
// they make the Electron binary behave as plain Node (it tries to `require` the
// workspace folder) or attach to the running instance. Strip them.
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
  killStaleBrains(); // deterministic: a prior interrupted run can't contaminate this gate
  const extensionDevelopmentPath = path.resolve(__dirname, '../..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index.js');
  const workspace = makeFixtureWorkspace();
  const vscodeExecutablePath = findLocalVSCode(extensionDevelopmentPath);

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
        MIGRAPILOT_STATE_DB: 'off',
      },
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    killStaleBrains(); // sweep any brain a crashed host left behind
  }
}

void main();
