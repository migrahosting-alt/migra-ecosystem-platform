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

/*
 * 🚨 A QUEUED DOCUMENT IS INTERRUPTED TOO — AND MORE CERTAINLY.
 *
 * `queued` was added so a document waiting behind another stops being reported
 * as `processing`, which was a small lie told to every user in the queue. But
 * the queue itself is IN MEMORY and lost on restart, so a queued row after a
 * restart references nothing: no job holds it, and none ever will. Recovery
 * originally matched only `processing`, which would have left those rows saying
 * "Waiting to start" for ever — the exact never-ending status this file exists
 * to clear, reached through the state added to make queueing honest.
 */
test('a queued document left by a restart is recovered, not stranded', () => {
  const action = decideRecovery(
    { fileName: 'book.pdf', state: 'queued', startedAt: 0, updatedAt: 0 } as never,
    { now: 60 * 60 * 1000, existingFiles: new Set(['book.pdf']), activeJobs: new Set() },
  );
  assert.notEqual(action.kind, 'leave', 'a stranded queued row must not be left alone');
});

test('a queued document a live job owns is left alone', () => {
  // This process picked it up already; closing it would fight a running job.
  const action = decideRecovery(
    { fileName: 'book.pdf', state: 'queued', startedAt: 0, updatedAt: 0 } as never,
    { now: 60 * 60 * 1000, existingFiles: new Set(['book.pdf']), activeJobs: new Set(['book.pdf']) },
  );
  assert.equal(action.kind, 'leave');
});

test('terminal states are still never touched by recovery', () => {
  for (const state of ['ready', 'ocr_failed', 'no_text_layer', 'encrypted', 'corrupt'] as const) {
    const action = decideRecovery(
      { fileName: 'book.pdf', state, startedAt: 0, updatedAt: 0 } as never,
      { now: 60 * 60 * 1000, existingFiles: new Set(['book.pdf']), activeJobs: new Set() },
    );
    assert.equal(action.kind, 'leave', `${state} is finished and must be left alone`);
  }
})

/*
 * 🚨 THE STALE WINDOW IS A TRUTHFULNESS BUDGET, NOT A TUNING KNOB.
 *
 * At 15 minutes, a Brain restart left the UI reporting "Reading text — page 10
 * of 24" for work that had already stopped — a specific, advancing-looking
 * number describing a process that no longer existed. Observed live.
 */
test('a job whose heartbeat stopped is recovered within a few minutes', () => {
  const action = decideRecovery(
    { fileName: 'book.pdf', state: 'processing', startedAt: 0, updatedAt: 0 } as never,
    { now: 3 * 60 * 1000, existingFiles: new Set(['book.pdf']), activeJobs: new Set() },
  );
  assert.notEqual(action.kind, 'leave',
    'three minutes without a heartbeat must not still read as live progress');
});

test('a job that wrote recently is left alone', () => {
  // The scanned job heartbeats before EVERY page — every 15-24s at the measured
  // OCR rate — so a recent write genuinely means work is happening.
  const action = decideRecovery(
    { fileName: 'book.pdf', state: 'processing', startedAt: 0, updatedAt: 100_000 } as never,
    { now: 130_000, existingFiles: new Set(['book.pdf']), activeJobs: new Set() },
  );
  assert.equal(action.kind, 'leave');
});

test('🚨 a LIVE job is protected by ownership, never by the clock', () => {
  /*
   * This is what makes a short window safe. `indexing` is a single long
   * operation rather than a per-page loop, so it can legitimately go quiet for
   * longer than the threshold — and it is still left alone, because THIS process
   * owns it. Were this to regress, shortening the window would start killing
   * healthy jobs mid-index.
   */
  const action = decideRecovery(
    { fileName: 'book.pdf', state: 'processing', stage: 'indexing', startedAt: 0, updatedAt: 0 } as never,
    { now: 60 * 60 * 1000, existingFiles: new Set(['book.pdf']), activeJobs: new Set(['book.pdf']) },
  );
  assert.equal(action.kind, 'leave', 'an owned job is never reclaimed, however long it has been quiet');
})
