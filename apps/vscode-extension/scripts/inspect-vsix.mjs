#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const vsix = process.argv[2] ?? 'migrapilot-extension-0.1.0.vsix';
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);

const result = spawnSync('unzip', ['-Z1', vsix], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'unzip listing failed');
const files = result.stdout.split('\n').filter(Boolean).sort();
const forbidden = files.filter((file) =>
  file.endsWith('.tsbuildinfo') ||
  file.startsWith('extension/src/') ||
  file.startsWith('extension/dist/test/') ||
  file.endsWith('.test.js') ||
  file.includes('/test/') ||
  file.includes('/scripts/')
);
if (forbidden.length > 0) {
  throw new Error(`Forbidden files in VSIX:\n${forbidden.join('\n')}`);
}

const packageJson = files.includes('extension/package.json');
const bundledEntry = files.includes('extension/dist/extension.js');
if (!packageJson || !bundledEntry) {
  throw new Error('VSIX is missing package.json or bundled dist/extension.js.');
}

const staging = mkdtempSync(path.join(tmpdir(), 'migrapilot-vsix-inspect-'));
try {
  const unzip = spawnSync('unzip', ['-q', '-o', vsix, '-d', staging], { encoding: 'utf8' });
  if (unzip.status !== 0) throw new Error(unzip.stderr || 'VSIX extraction failed');
  const manifest = JSON.parse(readFileSync(path.join(staging, 'extension/package.json'), 'utf8'));
  const commands = manifest.contributes?.commands ?? [];
  const hiddenAgentApproval = commands.filter((entry) => {
    const text = `${entry.command ?? ''} ${entry.title ?? ''}`;
    return /agent/i.test(text) && /(approve|approval|reject|cancel|decide|execute)/i.test(text);
  });
  if (hiddenAgentApproval.length > 0) {
    throw new Error(`Packaged manifest exposes hidden Agent approval commands: ${hiddenAgentApproval.map((entry) => entry.command).join(', ')}`);
  }
  const bundled = readFileSync(path.join(staging, 'extension/dist/extension.js'), 'utf8');
  for (const disabledRecipe of ['workspace.test', 'npm.test']) {
    if (bundled.includes(disabledRecipe)) {
      throw new Error(`Packaged bundle contains disabled Agent recipe/tool surface: ${disabledRecipe}`);
    }
  }
  console.log(JSON.stringify({
    ok: true,
    fileCount: files.length,
    commandCount: commands.length,
    disabledRecipesAbsent: true,
    hiddenAgentApprovalCommands: 0,
    vsix: path.resolve(vsix),
  }, null, 2));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
