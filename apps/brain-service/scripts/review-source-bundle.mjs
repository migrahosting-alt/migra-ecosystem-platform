#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const args = new Set(process.argv.slice(2));

export function reviewSourceFiles(cwd = root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd, encoding: 'buffer' });
  if (result.status !== 0) throw new Error(result.stderr.toString('utf8') || 'git ls-files failed');
  return result.stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .filter((file) => !excluded(file))
    .sort();
}

function excluded(file) {
  return file.endsWith('.tsbuildinfo') ||
    file.includes('/.vscode-test/') ||
    file.includes('/node_modules/') ||
    file.includes('/dist/') ||
    file.includes('/coverage/') ||
    file.endsWith('.vsix') ||
    file.endsWith('.tar.gz') ||
    file.endsWith('.tgz');
}

async function archive(files, output) {
  const temp = await mkdtemp(path.join(tmpdir(), 'migrapilot-review-source-'));
  const listPath = path.join(temp, 'files.txt');
  await writeFile(listPath, files.join('\n') + '\n');
  const tar = spawnSync('tar', ['-czf', output, '-C', root, '-T', listPath], { cwd: root, encoding: 'utf8' });
  await rm(temp, { recursive: true, force: true });
  if (tar.status !== 0) throw new Error(tar.stderr || 'tar failed');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = reviewSourceFiles(root);
  if (args.has('--json')) {
    process.stdout.write(JSON.stringify({ root, files }, null, 2));
  } else if (args.has('--archive')) {
    const output = process.argv[process.argv.indexOf('--archive') + 1];
    if (!output) throw new Error('--archive requires an output path');
    await archive(files, path.resolve(output));
  } else {
    process.stdout.write(files.join('\n') + '\n');
  }
}
