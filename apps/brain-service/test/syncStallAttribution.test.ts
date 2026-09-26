import assert from 'node:assert/strict';
import test from 'node:test';

import { OllamaEmbedder } from '../src/engine/rag/embedder.js';
import { IndexService, type FileSource, type Scope, type SyncStage } from '../src/engine/rag/indexService.js';

/**
 * A SYNC THAT HANGS MUST BE BOUNDED, AND MUST SAY WHERE IT HUNG.
 *
 * 🚨 THE MEASURED FAILURE, staging 2026-09-26. `POST /api/ai/indexes/<id>/sync`
 * logged `incoming request` at 15:16:31 and NEVER logged a completion — no
 * response line, no error line, nothing. The user saw a 504 after ~39 s. Every
 * sync that did finish, before and after, took between sub-millisecond and
 * 469 ms, so the request stalled rather than ran slowly.
 *
 * Two distinct defects were behind it, and each has its own tests below.
 *
 * 1. `embedBatch` passed NO timeout and NO signal to `fetch`. The embedding
 *    provider is an Ollama on a TAILNET PEER, and a peer that sleeps or loses
 *    its route accepts the connection and then says nothing — the one failure a
 *    bare `fetch` waits out. Undici's own default is ~300 s per attempt, and the
 *    retry budget multiplies that by five.
 *
 * 2. Nothing recorded the stages of a sync, so the stall is STILL
 *    unattributable: listing and extracting every document, embedding one
 *    particular file, and the durable commit are all `await`s, and no evidence
 *    exists to say which one stopped. That is the same class as the auth silence
 *    defect — an event that leaves nothing to read costs the whole investigation
 *    again next time.
 *
 * The property under test for (2) is NOT that stage lines exist. It is that each
 * one is emitted BEFORE the step it names, because a line written after a step
 * completes is absent for exactly the step that hung.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };
const noSleep = async (): Promise<void> => {};

/**
 * A provider that accepts the request and never answers — the tailnet stall.
 *
 * TWO TIMERS, and both are deliberate.
 *
 * `AbortSignal.timeout()` schedules an UNREF'D timer, so it does not by itself
 * keep the event loop alive. A real `fetch` holds an open socket that does; this
 * fake holds nothing, and the first version of these tests died with "Promise
 * resolution is still pending but the event loop has already resolved" — every
 * case cancelled, proving nothing in either direction. `keepAlive` stands in for
 * that socket.
 *
 * `fallback` exists so the NEGATIVE CONTROL fails loudly. Remove the `signal`
 * from `embedBatch` and, without it, this promise would simply never settle and
 * the test would hang — a hang is a weak failure to read. Instead the fallback
 * rejects with its own message, the assertion on `signals` is reached, and the
 * control says exactly what is wrong.
 */
function stalledProvider(observed: { signals: number; calls: number }): typeof fetch {
  return ((_url: string, init?: { signal?: AbortSignal }) => {
    observed.calls += 1;
    if (init?.signal) observed.signals += 1;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const keepAlive = setTimeout(() => {}, 1_000);
      const fallback = setTimeout(() => {
        clearTimeout(keepAlive);
        reject(new Error('stalled provider was never aborted — no timeout reached it'));
      }, 250);
      const fail = (): void => {
        clearTimeout(keepAlive);
        clearTimeout(fallback);
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        reject(err);
      };
      if (!signal) return; // the defect: nothing will ever abort this
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    });
  }) as unknown as typeof fetch;
}

test('🚨 an embeddings request carries an abort signal', async () => {
  const observed = { signals: 0, calls: 0 };
  const embedder = new OllamaEmbedder(
    'http://x/v1', 'm', 'v1', undefined, stalledProvider(observed), 64, noSleep, 1, 40,
  );

  await assert.rejects(() => embedder.embed(['hello']));
  assert.equal(observed.calls, 1);
  assert.equal(observed.signals, 1, 'fetch was called with no signal — a stalled provider hangs for ever');
});

test('🚨 a provider that never answers is abandoned, and the error names the timeout', async () => {
  const observed = { signals: 0, calls: 0 };
  const embedder = new OllamaEmbedder(
    'http://x/v1', 'm', 'v1', undefined, stalledProvider(observed), 64, noSleep, 1, 40,
  );

  await assert.rejects(
    () => embedder.embed(['hello']),
    /embedder timed out after 40ms with no response/,
    'a bare DOMException reaching stats.lastError tells an operator nothing',
  );
});

test('a stall is treated as transient, so a blip still gets its retries', async () => {
  const observed = { signals: 0, calls: 0 };
  const embedder = new OllamaEmbedder(
    'http://x/v1', 'm', 'v1', undefined, stalledProvider(observed), 64, noSleep, 3, 20,
    // A deadline far beyond the three attempts, so only `attempts` bounds this.
    60_000,
  );

  await assert.rejects(() => embedder.embed(['hello']));
  assert.equal(observed.calls, 3, 'a timeout must stay retryable — one blip should not fail a whole sync');
});

test('🚨 retries stop at the batch deadline instead of spending the whole budget', async () => {
  const observed = { signals: 0, calls: 0 };
  /*
   * A CONTROLLED CLOCK. The deadline is about elapsed time, and a test that
   * waited for it in real seconds would be slow enough that nobody runs it.
   * Each reading advances 30 s, so the second attempt is already past a 45 s
   * deadline.
   */
  let clock = 0;
  const embedder = new OllamaEmbedder(
    'http://x/v1', 'm', 'v1', undefined, stalledProvider(observed), 64, noSleep, 5, 20,
    45_000,
    () => (clock += 30_000),
  );

  await assert.rejects(
    () => embedder.embed(['hello']),
    /gave up after \d+ attempts in 45000ms/,
    'the deadline must report itself, not the last transport message',
  );
  assert.ok(
    observed.calls < 5,
    `spent all ${observed.calls} attempts on a provider that is gone, not blipping`,
  );
});

test('🚨 the deadline is the real bound, not the deadline plus one more attempt', async () => {
  const observed = { signals: 0, calls: 0 };
  /*
   * REAL TIMERS, deliberately, because the thing under test is how long this
   * actually takes. A controlled clock could not catch the defect: the deadline
   * is checked only BETWEEN attempts, so a final full-length attempt starting
   * just inside the deadline overshoots it, and only elapsed time shows that.
   *
   * 100 ms request timeout, 120 ms deadline. Clamped, the second attempt gets the
   * ~20 ms that remain and the whole call ends near 120 ms. Unclamped it gets a
   * further 100 ms and ends near 200 ms.
   */
  const embedder = new OllamaEmbedder(
    'http://x/v1', 'm', 'v1', undefined, stalledProvider(observed), 64, noSleep, 5, 100, 120,
  );

  const began = Date.now();
  await assert.rejects(() => embedder.embed(['hello']));
  const elapsed = Date.now() - began;

  assert.ok(
    elapsed < 175,
    `took ${elapsed}ms against a 120ms deadline — an attempt was allowed to overshoot it`,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Stage attribution
// ─────────────────────────────────────────────────────────────────────────────

/** Builds a service over one file, recording every stage in order. */
function serviceOverOneFile(opts: {
  /** Runs when the embedder is entered — used to inspect what was logged by then. */
  onEmbed?: () => void;
  /** Runs when the file source is entered. */
  onList?: () => void;
  embedThrows?: boolean;
}): { service: IndexService; stages: Array<{ stage: SyncStage; fields: Record<string, unknown> }> } {
  const stages: Array<{ stage: SyncStage; fields: Record<string, unknown> }> = [];
  let clock = 1_000_000;
  const service = new IndexService(
    {
      model: 'm',
      version: 'v1',
      embed: async (texts: string[]) => {
        opts.onEmbed?.();
        if (opts.embedThrows) throw new Error('embedder timed out after 30000ms with no response');
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
    },
    (): FileSource => ({
      files: async () => {
        opts.onList?.();
        return [{ relPath: 'docs/liv_kreyol.md', content: '# liv\n\nYon fraz an kreyòl.\n' }];
      },
    }),
    () => (clock += 1000),
    undefined,
    undefined,
    (stage, fields) => stages.push({ stage, fields }),
  );
  return { service, stages };
}

test('🚨 the file being embedded is named BEFORE embedding starts', async () => {
  let seenAtEmbedTime: Array<{ stage: SyncStage; fields: Record<string, unknown> }> = [];
  const held = serviceOverOneFile({
    onEmbed: () => {
      seenAtEmbedTime = held.stages.map((s) => ({ ...s }));
    },
  });

  const rec = await held.service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  const res = await held.service.sync(rec.id, scope);
  assert.equal(res.ok, true);

  /*
   * THIS IS THE WHOLE POINT. The embedder stands in for the stalled provider:
   * whatever had been logged by the time it was entered is all an operator would
   * ever get if it never returned. `embedding_file` must already be there, with
   * the file named.
   */
  const named = seenAtEmbedTime.find((s) => s.stage === 'embedding_file');
  assert.ok(named, 'nothing named the embedding step before it blocked — a hang stays unattributable');
  assert.equal(named.fields.file, 'docs/liv_kreyol.md');
  assert.ok(
    seenAtEmbedTime.some((s) => s.stage === 'files_listed'),
    'file listing was not reported before embedding began',
  );
});

test('🚨 document listing is announced before it is entered', async () => {
  let seenAtListTime: SyncStage[] = [];
  const held = serviceOverOneFile({
    onList: () => {
      seenAtListTime = held.stages.map((s) => s.stage);
    },
  });

  const rec = await held.service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  await held.service.sync(rec.id, scope);

  // Extraction of every PDF/DOCX/PPTX happens inside `files()` on every sync, so
  // a hang in here is as likely as one in the embedder and must be as visible.
  assert.ok(
    seenAtListTime.includes('listing_files'),
    'a sync hung while extracting documents would log nothing about it',
  );
  assert.ok(!seenAtListTime.includes('files_listed'), 'files_listed cannot precede the listing');
});

test('a failed sync reports WHICH stage it died in', async () => {
  const held = serviceOverOneFile({ embedThrows: true });
  const rec = await held.service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  const res = await held.service.sync(rec.id, scope);
  assert.equal(res.ok, false);

  const failed = held.stages.find((s) => s.stage === 'sync_failed');
  assert.ok(failed, 'a sync failed with no stage recorded');
  assert.equal(failed.fields.stage, 'embedding_file', '"it failed" was already knowable; where it failed was not');
  assert.match(String(failed.fields.error), /timed out after 30000ms/);
});

test('a healthy sync reports completion with its duration', async () => {
  const held = serviceOverOneFile({});
  const rec = await held.service.createIndex(scope, { sourceType: 'docs', root: '/r' });
  await held.service.sync(rec.id, scope);

  const done = held.stages.find((s) => s.stage === 'sync_completed');
  assert.ok(done, 'a completed sync must be distinguishable from one still running');
  assert.equal(typeof done.fields.ms, 'number');
  // An operator reading `embedding_file` with no `file_embedded` after it is
  // reading a sync that is stuck, so the closing line has to be there too.
  assert.ok(held.stages.some((s) => s.stage === 'file_embedded'));
});
