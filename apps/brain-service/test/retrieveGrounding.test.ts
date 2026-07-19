// Lexical chat grounding. Proves `retrieveContext` searches the working tree and
// returns REAL code snippets — the fix for the chat model answering repository
// questions from imagination instead of from the actual code. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { retrieveContext, salientTermsWeighted } from '../src/retrieval/retrieve.js';

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

test('salientTermsWeighted ranks identifiers above generic words and drops filler', () => {
  const terms = salientTermsWeighted('What does computeInvoiceTotal do? Cite the file.');
  assert.equal(terms[0]?.term, 'computeInvoiceTotal', 'the identifier is the top term');
  assert.ok(terms[0]!.weight >= 3, 'identifier weight is high');
  const words = terms.map((t) => t.term.toLowerCase());
  for (const filler of ['cite', 'file', 'does', 'what', 'the']) {
    assert.ok(!words.includes(filler), `filler word "${filler}" must be dropped`);
  }
});

test('retrieveContext ranks the DEFINING file first and captures its body', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-retrieve-def-')));
  fs.mkdirSync(path.join(dir, 'src'));
  // The definition + body (what actually answers "what does X do").
  fs.writeFileSync(
    path.join(dir, 'src', 'inspect.ts'),
    ['// header', 'export function registerInspectRoutes(app) {', "  app.post('/api/ai/inspect', handler);", '  return app;', '}', ''].join('\n'),
  );
  // A different file that only CALLS it (a reference, not a definition).
  fs.writeFileSync(path.join(dir, 'src', 'server.ts'), ['import { registerInspectRoutes } from "./inspect";', 'registerInspectRoutes(app);', ''].join('\n'));

  const res = await retrieveContext({ query: 'What does registerInspectRoutes do? Cite the file.', workspaceRoot: dir, feature: 'chat', maxChunks: 6 });
  const grep = res.chunks.filter((c) => c.source === 'grep');
  assert.ok(grep.length >= 1, 'at least one grep chunk');
  assert.ok(grep[0]!.path.endsWith('inspect.ts'), 'the DEFINING file ranks first, not the caller');
  assert.match(grep[0]!.snippet, /app\.post\('\/api\/ai\/inspect'/, 'the snippet captures the function BODY, not just the signature');
});

test('retrieveContext finds the function definition even when schemas/types crowd the name', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-retrieve-crowd-')));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'types'));
  // The real implementation.
  fs.writeFileSync(path.join(dir, 'src', 'compute.ts'), ['export function computeThing(x: number) {', '  return x * 2;', '}', ''].join('\n'));
  // Many files sharing the substring but NOT defining the function.
  fs.writeFileSync(path.join(dir, 'types', 'schema.ts'), ['export const ComputeThingSchema = 1;', 'export interface ComputeThingRequest {}', 'export type ComputeThingResponse = number;', ''].join('\n'));
  fs.writeFileSync(path.join(dir, 'types', 'more.ts'), 'export const AlsoComputeThingThing = 2;\n');

  const res = await retrieveContext({ query: 'What does computeThing do? Cite the file.', workspaceRoot: dir, feature: 'chat', maxChunks: 6 });
  const grep = res.chunks.filter((c) => c.source === 'grep');
  assert.ok(grep[0]!.path.endsWith('compute.ts'), 'the function-DEFINING file ranks first, not the schema/type files');
  assert.match(grep[0]!.snippet, /function computeThing/);
});

test('retrieveContext drops noise files that only matched a generic word', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'migra-retrieve-noise-')));
  fs.mkdirSync(path.join(dir, 'src'));
  // The real answer: defines the distinctive identifier.
  fs.writeFileSync(path.join(dir, 'src', 'auth.ts'), ['export function verifyAuthToken() {', '  return true; // cite', '}', ''].join('\n'));
  // Noise: contains the generic word "cite" but NOT the identifier.
  fs.writeFileSync(path.join(dir, 'src', 'unrelated1.ts'), 'const x = 1; // please cite this\n');
  fs.writeFileSync(path.join(dir, 'src', 'unrelated2.ts'), 'const y = 2; // cite me too\n');

  const res = await retrieveContext({ query: 'What does verifyAuthToken do? Cite the file.', workspaceRoot: dir, feature: 'chat', maxChunks: 6 });
  const grep = res.chunks.filter((c) => c.source === 'grep').map((c) => path.basename(c.path));
  assert.ok(grep.includes('auth.ts'), 'the file defining the identifier is retrieved');
  assert.ok(!grep.includes('unrelated1.ts') && !grep.includes('unrelated2.ts'), 'generic-word-only noise files are dropped');
});

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
