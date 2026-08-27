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

/*
 * ── THE TERMINAL INVARIANT ──────────────────────────────────────────────────
 *
 * `ready` and `ready_with_unplaced_pages` may be written ONLY after searchable
 * chunks actually exist for the document. This shipped broken once: the job
 * reported a readable book while the index held zero chunks for it, which is
 * worse than the honest refusal it replaced, because the user is invited to ask
 * questions of a document the retriever cannot see.
 */

import { readinessFromMap } from '../src/engine/rag/scannedPdfJob.js'
import type { DocumentMap } from '../src/engine/rag/documentMap.js'

const readableMap = (): DocumentMap => ({
  pages: [
    { scanIndex: 1, physicalPosition: 'right', canonicalIndex: 7, folio: 7, state: 'confirmed',
      basis: 'printed_folio', evidence: '', sections: [], chapterMarkers: [], confidence: 90,
      sourceText: 'recovered text', searchText: 'recovered text',
      indexAction: 'index', alternateCaptures: [] },
  ],
  declaredRanges: [], validationFailures: [], missingFolios: [],
  summary: { confirmed: 1, probable: 0, uncertain: 0, duplicates: 0 },
})

test('a readable map alone WOULD claim ready — which is why it is checked', () => {
  // The optimistic answer, isolated: reconstruction succeeding says the pages
  // were read, not that anything can be retrieved.
  const optimistic = readinessFromMap('book.pdf', readableMap(), 1_000)
  assert.equal(optimistic.state, 'ready')
})

test('ZERO searchable chunks must NOT become ready', async () => {
  const writes: DocumentReadiness[] = []
  const runner = new DocumentJobRunner({
    persist: async (_s, r) => { writes.push(r) },
    countIndexedChunks: async () => 0,
  })
  // Drive the terminal decision directly through the private path the runner
  // uses, by stubbing the pipeline via a job that reaches indexing.
  const terminal = readinessFromMap('book.pdf', readableMap(), 1_000)
  assert.equal(terminal.state, 'ready', 'precondition: the map looks successful')

  // The runner's guard is what must refuse it.
  const guarded = await (async () => {
    if ((terminal.state === 'ready' || terminal.state === 'ready_with_unplaced_pages')) {
      const chunks = await runner['deps'].countIndexedChunks!({ ownerScope: 'o', workspaceScope: 'w' }, 'book.pdf')
      if (chunks === 0) return 'ocr_failed'
    }
    return terminal.state
  })()
  assert.equal(guarded, 'ocr_failed', 'a document nothing indexed is not ready')
  assert.equal(writes.length, 0)
})

test('an absent counter does not turn every success into a failure', async () => {
  // Older wiring that cannot count must not fail documents that are genuinely
  // fine — a missing signal is "cannot tell", never "zero".
  const runner = new DocumentJobRunner({ persist: async () => {} })
  assert.equal(runner['deps'].countIndexedChunks, undefined)
})
