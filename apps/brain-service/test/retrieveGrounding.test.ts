// Lexical chat grounding. Proves `retrieveContext` searches the working tree and
// returns REAL code snippets — the fix for the chat model answering repository
// questions from imagination instead of from the actual code. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { retrieveContext } from '../src/retrieval/retrieve.js';

function tmpWorkspace(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-retrieve-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(
    path.join(dir, 'src', 'billing.ts'),
    ['// billing module', 'export function computeInvoiceTotal(items: number[]) {', '  return items.reduce((a, b) => a + b, 0);', '}', ''].join('\n'),
  );
  fs.writeFileSync(path.join(dir, 'src', 'noise.ts'), 'export const unrelated = 1;\n');
  return dir;
}

test('retrieveContext returns real workspace snippets grounded on the query term', async () => {
  const dir = tmpWorkspace();
  const res = await retrieveContext({
    query: 'What does computeInvoiceTotal do?',
    workspaceRoot: dir,
    feature: 'chat',
    maxChunks: 6,
  });

  const grep = res.chunks.filter((c) => c.source === 'grep');
  assert.ok(grep.length >= 1, 'must return at least one lexical chunk');
  const hit = grep.find((c) => c.path.endsWith('billing.ts'));
  assert.ok(hit, 'must surface the file that defines the symbol');
  assert.match(hit!.snippet, /computeInvoiceTotal/, 'snippet contains the real definition');
  assert.ok(hit!.startLine >= 1 && hit!.endLine >= hit!.startLine, 'valid line range');
});

test('retrieveContext returns no lexical chunks (and says so) when nothing matches', async () => {
  const dir = tmpWorkspace();
  const res = await retrieveContext({
    query: 'Explain the frobnicateQuantumFluxCapacitor routine',
    workspaceRoot: dir,
    feature: 'chat',
    maxChunks: 6,
  });
  assert.equal(res.chunks.filter((c) => c.source === 'grep').length, 0, 'no fabricated matches');
  assert.match(String(res.repoSummary ?? ''), /No matching source/i);
});

test('retrieveContext still includes the active file as a recency chunk', async () => {
  const dir = tmpWorkspace();
  const active = path.join(dir, 'src', 'noise.ts');
  const res = await retrieveContext({
    query: 'anything',
    workspaceRoot: dir,
    feature: 'chat',
    activeFile: active,
    maxChunks: 6,
  });
  assert.ok(res.chunks.some((c) => c.source === 'recent' && c.path === active), 'active file included');
});
