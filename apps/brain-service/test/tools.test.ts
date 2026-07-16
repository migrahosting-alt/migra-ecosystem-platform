import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { diagnosticsGet } from '../src/tools/diagnosticsGet.js';
import { editApply } from '../src/tools/editApply.js';
import { editPreview } from '../src/tools/editPreview.js';
import { fileReadRange } from '../src/tools/fileReadRange.js';
import { fileReadSymbol } from '../src/tools/fileReadSymbol.js';
import { gitDiff } from '../src/tools/gitDiff.js';
import { gitStatus } from '../src/tools/gitStatus.js';
import { setDiagnostics } from '../src/tools/diagnosticsStore.js';
import { workspaceSearch } from '../src/tools/workspaceSearch.js';

const execFile = promisify(execFileCallback);

test('workspace.search and file.readRange return narrow file evidence', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'migrapilot-tools-'));
  const filePath = path.join(workspaceRoot, 'src', 'example.ts');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, ['export function alpha() {', '  return 42;', '}', ''].join('\n'), 'utf8');

  const searchResult = await workspaceSearch({
    rootPath: workspaceRoot,
    query: 'alpha',
    limit: 20,
    includeGlobs: [],
    excludeGlobs: [],
  });

  assert.equal(searchResult.tool, 'workspace.search');
  assert.equal(searchResult.matches[0]?.path, 'src/example.ts');

  const readResult = await fileReadRange({
    rootPath: workspaceRoot,
    path: 'src/example.ts',
    startLine: 1,
    endLine: 2,
  });

  assert.equal(readResult.tool, 'file.readRange');
  assert.match(readResult.content, /return 42/);
});

test('file.readSymbol resolves by symbol name and enclosing line', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'migrapilot-symbol-'));
  const filePath = path.join(workspaceRoot, 'src', 'symbol.ts');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, [
    'export function alpha() {',
    '  return 42;',
    '}',
    '',
    'export class Bravo {',
    '  method() {',
    '    return alpha();',
    '  }',
    '}',
    '',
  ].join('\n'), 'utf8');

  const byName = await fileReadSymbol({
    rootPath: workspaceRoot,
    path: 'src/symbol.ts',
    symbolName: 'alpha',
  });
  assert.equal(byName.tool, 'file.readSymbol');
  assert.equal(byName.kind, 'function');
  assert.match(byName.content, /return 42/);

  const byLine = await fileReadSymbol({
    rootPath: workspaceRoot,
    path: 'src/symbol.ts',
    line: 6,
  });
  assert.equal(byLine.symbolName, 'method');
  assert.equal(byLine.kind, 'method');
});

test('git.status and git.diff inspect repository state', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'migrapilot-git-'));
  await execFile('git', ['init'], { cwd: workspaceRoot });
  await execFile('git', ['config', 'user.email', 'migra@example.com'], { cwd: workspaceRoot });
  await execFile('git', ['config', 'user.name', 'MigraPilot'], { cwd: workspaceRoot });

  const filePath = path.join(workspaceRoot, 'README.md');
  await writeFile(filePath, '# Hello\n', 'utf8');
  await execFile('git', ['add', 'README.md'], { cwd: workspaceRoot });
  await execFile('git', ['commit', '-m', 'init'], { cwd: workspaceRoot });
  await writeFile(filePath, '# Hello\n\nUpdated\n', 'utf8');

  const statusResult = await gitStatus({
    rootPath: workspaceRoot,
  });
  assert.equal(statusResult.tool, 'git.status');
  assert.equal(statusResult.files[0]?.path, 'README.md');
  assert.equal(statusResult.files[0]?.worktreeStatus.trim(), 'M');

  const diffResult = await gitDiff({
    rootPath: workspaceRoot,
    path: 'README.md',
    staged: false,
  });
  assert.equal(diffResult.tool, 'git.diff');
  assert.match(diffResult.diff, /Updated/);
});

test('edit.preview, edit.apply, and diagnostics.get are deterministic', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'migrapilot-edit-'));
  const filePath = path.join(workspaceRoot, 'sample.ts');
  await writeFile(filePath, ['const value = 1;', 'console.log(value);', ''].join('\n'), 'utf8');

  const previewResult = await editPreview({
    rootPath: workspaceRoot,
    changes: [
      {
        path: 'sample.ts',
        startLine: 1,
        endLine: 1,
        replacement: 'const value = 2;',
      },
    ],
  });
  assert.equal(previewResult.tool, 'edit.preview');
  assert.match(previewResult.files[0]?.after ?? '', /const value = 2/);

  const applyResult = await editApply({
    rootPath: workspaceRoot,
    changes: [
      {
        path: 'sample.ts',
        startLine: 1,
        endLine: 1,
        replacement: 'const value = 2;',
      },
    ],
  });
  assert.equal(applyResult.tool, 'edit.apply');
  assert.equal(applyResult.files[0]?.changed, true);

  const updatedContent = await readFile(filePath, 'utf8');
  assert.match(updatedContent, /const value = 2/);

  setDiagnostics(workspaceRoot, [
    {
      path: 'sample.ts',
      severity: 'error',
      code: 'TS1005',
      source: 'ts',
      message: 'Example failure',
      range: {
        startLine: 2,
        startCharacter: 1,
        endLine: 2,
        endCharacter: 10,
      },
    },
  ]);

  const diagnosticsResult = await diagnosticsGet({
    rootPath: workspaceRoot,
    path: 'sample.ts',
  });
  assert.equal(diagnosticsResult.tool, 'diagnostics.get');
  assert.equal(diagnosticsResult.items.length, 1);
  assert.equal(diagnosticsResult.items[0]?.message, 'Example failure');
});