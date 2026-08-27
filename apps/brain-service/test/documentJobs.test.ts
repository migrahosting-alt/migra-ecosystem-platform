/**
 * The queue must return immediately and never leave a job implying progress.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DocumentJobRunner, classifyFailure, describeFailure } from '../src/engine/rag/documentJobs.js';
import type { DocumentReadiness } from '../src/engine/rag/documentReadiness.js';

const scope = { ownerScope: 'user:a', workspaceScope: 'org:a' };

test('enqueue records PENDING state before returning', async () => {
  // The caller's request ends here. If nothing were written first, the user would
  // reload and find no status at all for a file that is genuinely being worked on.
  const writes: DocumentReadiness[] = [];
  const runner = new DocumentJobRunner({
    persist: async (_s, r) => { writes.push(r) },
  });
  await runner.enqueue(scope, 'book.pdf', '/nonexistent/book.pdf');
  assert.equal(writes[0]?.state, 'processing');
  assert.equal(writes[0]?.stage, 'uploaded', 'the first durable fact is that work is pending');
});

test('the same document is not queued twice', async () => {
  const writes: DocumentReadiness[] = [];
  const runner = new DocumentJobRunner({ persist: async (_s, r) => { writes.push(r) } });
  await runner.enqueue(scope, 'book.pdf', '/nonexistent/book.pdf');
  await runner.enqueue(scope, 'book.pdf', '/nonexistent/book.pdf');
  assert.equal(writes.filter((w) => w.stage === 'uploaded').length, 1, 'a double upload must not run twice');
});

test('a failing job lands in a TERMINAL state, never stuck processing', async () => {
  const writes: DocumentReadiness[] = [];
  const runner = new DocumentJobRunner({ persist: async (_s, r) => { writes.push(r) } });
  await runner.enqueue(scope, 'missing.pdf', '/definitely/not/here.pdf');

  // Let the queue drain — the job fails because the file does not exist.
  await new Promise((r) => setTimeout(r, 300));
  const last = writes[writes.length - 1]!;
  assert.notEqual(last.state, 'processing', '"Reading…" forever is worse than an error');
  assert.equal(last.state, 'ocr_failed');
  assert.ok((last.failureReason ?? '').length > 0, 'a failure must say something');
});

test('a missing binary blames the SERVER, not the document', () => {
  // Telling the user their book is unreadable would send them to re-scan a
  // perfectly good file for an operator problem.
  assert.match(describeFailure(new Error("spawn pdftoppm ENOENT")), /renderer is not available on this server/);
  assert.match(describeFailure(new Error("spawn tesseract ENOENT")), /recogniser is not available on this server/);
});

test('extraction failures keep their specific state', () => {
  assert.equal(classifyFailure({ failure: { kind: 'encrypted' } }), 'encrypted');
  assert.equal(classifyFailure({ failure: { kind: 'corrupt' } }), 'corrupt');
  assert.equal(classifyFailure({ failure: { kind: 'no_text_layer' } }), 'no_text_layer');
});

test('active jobs are reported so boot recovery does not steal them', async () => {
  const runner = new DocumentJobRunner({ persist: async () => {} });
  await runner.enqueue(scope, 'busy.pdf', '/nonexistent/busy.pdf');
  assert.ok(runner.activeJobs().has('busy.pdf'), 'recovery must not resume a job already in flight');
});
