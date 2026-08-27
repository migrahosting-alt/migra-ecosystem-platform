/**
 * Boot recovery: an interrupted job must never sit at "Reading…" forever.
 *
 * A stale spinner costs the user more than an error does — an error tells them
 * to act, a spinner tells them to wait for something nobody is doing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decideRecovery, STALE_AFTER_MS, exhaustedReadiness, MAX_RESUME_ATTEMPTS } from '../src/engine/rag/scannedJobRecovery.js';
import type { DocumentReadiness } from '../src/engine/rag/documentReadiness.js';

const NOW = 10_000_000;
const processing = (over: Partial<DocumentReadiness> = {}): DocumentReadiness => ({
  fileName: 'book.pdf', state: 'processing', stage: 'reading_text',
  startedAt: NOW - STALE_AFTER_MS * 2, updatedAt: NOW - STALE_AFTER_MS * 2, ...over,
});
const files = new Set(['book.pdf']);

test('a stale job is resumed from the beginning', () => {
  const action = decideRecovery(processing(), { now: NOW, existingFiles: files });
  assert.equal(action.kind, 'resume');
  // Resuming mid-stage would need partial state nothing persists; the pipeline is
  // idempotent, so starting over is both correct and simpler than pretending.
  assert.equal(action.kind === 'resume' ? action.from : null, 'rendering_pages');
});

test('a RECENT job is left alone — another process may own it', () => {
  const action = decideRecovery(processing({ updatedAt: NOW - 5_000 }), { now: NOW, existingFiles: files });
  assert.equal(action.kind, 'leave', 'claiming it would run two jobs over one document');
});

test('a job this process is already running is left alone', () => {
  const action = decideRecovery(processing(), {
    now: NOW, existingFiles: files, activeJobs: new Set(['book.pdf']),
  });
  assert.equal(action.kind, 'leave');
});

test('a job whose file was deleted FAILS truthfully rather than resuming', () => {
  const action = decideRecovery(processing(), { now: NOW, existingFiles: new Set() });
  assert.equal(action.kind, 'fail');
  if (action.kind === 'fail') {
    assert.equal(action.readiness.state, 'ocr_failed');
    assert.match(action.readiness.failureReason ?? '', /removed before reading finished/);
    // Never left processing: that would show a status for a file the user cannot see.
    assert.notEqual(action.readiness.state, 'processing');
  }
});

test('a finished document is not treated as interrupted', () => {
  for (const state of ['ready', 'ready_with_unplaced_pages', 'encrypted', 'corrupt'] as const) {
    const action = decideRecovery({ fileName: 'x.pdf', state }, { now: NOW, existingFiles: files });
    assert.equal(action.kind, 'leave', `${state} must not be resumed`);
  }
});

test('a document that keeps killing the process stops being retried', () => {
  // Otherwise a PDF that reliably crashes becomes a boot loop: start, crash,
  // resume, crash.
  const done = exhaustedReadiness(processing(), MAX_RESUME_ATTEMPTS);
  assert.equal(done.state, 'ocr_failed');
  assert.match(done.failureReason ?? '', /interrupted 3 times/);
});
