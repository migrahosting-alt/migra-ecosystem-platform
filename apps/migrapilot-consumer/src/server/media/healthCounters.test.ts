/**
 * The counters that turn a log line into an alert.
 *
 * WHY THIS EXISTS. `migrapilot.media.health` was emitted to `console.info` and
 * consumed by nothing — object storage could have been failing every read for
 * weeks while every page looked perfectly healthy, because the local fallback
 * kept serving. These tests assert the two properties a monitoring path needs:
 * the numbers reach a file something else can read, and the act of counting can
 * never break the read it was counting.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  recordMediaHealth, mediaHealthSnapshot, flushMediaHealth, resetMediaHealth,
} from './healthCounters'

/*
 * The destination is read from the environment on every flush, so a plain
 * static import is enough — an earlier version used a top-level `await import`
 * to set the variable first and hung the runner outright.
 */
const dir = mkdtempSync(join(tmpdir(), 'media-health-'))
const file = join(dir, 'media-health.json')
process.env.MIGRAPILOT_MEDIA_HEALTH_FILE = file

const read = (): { counts: Record<string, number>; last: Record<string, { key: string }> } =>
  JSON.parse(readFileSync(file, 'utf8'))

test('a mismatch is persisted immediately, not batched', () => {
  /*
   * The one event that most needs to survive a crash is the one saying the bytes
   * were WRONG. Batching it would mean the evidence dies with the process.
   */
  resetMediaHealth()
  recordMediaHealth({ kind: 'mismatch', key: 'img_a', detail: 'hash did not match' })

  assert.ok(existsSync(file), 'a mismatch must hit the disk without waiting for a flush')
  const persisted = read()
  assert.equal(persisted.counts.mismatch, 1)
  assert.equal(persisted.last.mismatch!.key, 'img_a')
})

test('every kind is counted separately', () => {
  resetMediaHealth()
  for (const kind of ['fallback', 'mismatch', 'error', 'write-failed', 'delete-failed'] as const) {
    recordMediaHealth({ kind, key: `k-${kind}` })
  }
  flushMediaHealth()

  const { counts } = read()
  // Distinct counters, because a routine fallback and a lost write must not
  // raise the same alert.
  assert.equal(counts.fallback, 1)
  assert.equal(counts.mismatch, 1)
  assert.equal(counts.error, 1)
  assert.equal(counts['write-failed'], 1)
  assert.equal(counts['delete-failed'], 1)
})

test('counts accumulate rather than overwrite', () => {
  resetMediaHealth()
  for (let i = 0; i < 5; i += 1) recordMediaHealth({ kind: 'fallback', key: `img_${i}` })
  flushMediaHealth()
  assert.equal(read().counts.fallback, 5)
  assert.equal(mediaHealthSnapshot().counts.fallback, 5)
})

test('the snapshot identifies the process, so a restart is distinguishable from a quiet period', () => {
  resetMediaHealth()
  recordMediaHealth({ kind: 'error', key: 'img_x' })
  const persisted = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; startedAt: number }
  assert.equal(persisted.pid, process.pid)
  assert.ok(persisted.startedAt > 0)
})

test('an unwritable destination is REPORTED, not swallowed', () => {
  /*
   * THE DEFECT THIS CAUGHT. The first deployment wrote to a path the service
   * could not write under `ProtectSystem=strict`. Every flush failed, the catch
   * hid it, and the counters file simply never appeared — indistinguishable
   * from "nothing has gone wrong yet". Silence is the one outcome a monitoring
   * component may not have.
   */
  resetMediaHealth()
  const errors: string[] = []
  const original = console.error
  console.error = (line: unknown) => { errors.push(String(line)) }
  try {
    process.env.MIGRAPILOT_MEDIA_HEALTH_FILE = '/dev/null/health.json'
    recordMediaHealth({ kind: 'mismatch', key: 'img_c' })
    assert.equal(errors.length, 1, 'the failure is announced')
    assert.match(errors[0]!, /persist_failed/)
    // Reported once per outage, not once per event — a broken path must not
    // become its own flood.
    recordMediaHealth({ kind: 'mismatch', key: 'img_d' })
    assert.equal(errors.length, 1, 'and not repeated for every subsequent event')
  } finally {
    console.error = original
    process.env.MIGRAPILOT_MEDIA_HEALTH_FILE = file
  }
})

test('an unwritable destination never throws', () => {
  /*
   * THE POINT. Telemetry sits inside the read path. If a full disk or a bad
   * permission could throw here, monitoring would take down the very thing it
   * exists to watch — a strictly worse outcome than not counting.
   */
  resetMediaHealth()
  /*
   * `/dev/null/...` fails with ENOTDIR immediately. A path under `/proc` looks
   * like the obvious choice and HANGS `mkdirSync` outright on this kernel — the
   * test suite froze rather than failed, which is the worse outcome.
   */
  process.env.MIGRAPILOT_MEDIA_HEALTH_FILE = '/dev/null/health.json'
  assert.doesNotThrow(() => recordMediaHealth({ kind: 'mismatch', key: 'img_b' }))
  // And the number is still held in memory for the next successful flush.
  assert.equal(mediaHealthSnapshot().counts.mismatch, 1)
  process.env.MIGRAPILOT_MEDIA_HEALTH_FILE = file
})

test('a reader never sees a half-written file', () => {
  // Written to a temporary sibling and renamed. Asserted by parsing after every
  // single write, which would throw on a truncated document.
  resetMediaHealth()
  for (let i = 0; i < 20; i += 1) {
    recordMediaHealth({ kind: 'mismatch', key: `img_${i}` })
    assert.doesNotThrow(() => read(), 'the file parsed cleanly mid-sequence')
  }
  assert.equal(read().counts.mismatch, 20)
})
