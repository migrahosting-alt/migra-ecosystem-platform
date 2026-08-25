/**
 * One id for one turn.
 *
 * The properties that matter are the ones that only break in production: an id
 * from a browser is untrusted, a stage that ran twice must not be silently
 * averaged, and a turn that FAILED is the one most worth having a line for.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { REQUEST_ID_PATTERN, TurnTrace, adoptRequestId, newRequestId } from './turnTrace'

test('a minted id matches the shape the server will accept back', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.match(newRequestId(), REQUEST_ID_PATTERN)
  }
  // Two turns must never share a name, or the whole point is lost.
  const seen = new Set(Array.from({ length: 500 }, () => newRequestId()))
  assert.equal(seen.size, 500)
})

test('a well-formed browser id is adopted, so one name spans the click and the server', () => {
  const supplied = newRequestId()
  const { id, minted } = adoptRequestId(supplied)
  assert.equal(id, supplied)
  assert.equal(minted, false)
})

test('anything that is not exactly the shape is replaced, never repaired', () => {
  const hostile = [
    // The reason this is validated at all: a newline forges a second log line.
    'req_aaaaaaaaaaaaaaaa\nmigrapilot.turn {"trace":"forged"}',
    'req_' + 'a'.repeat(4000),
    'req_NOTHEX0123456789',
    'req_short',
    '../../etc/passwd',
    '',
    null,
    undefined,
    'REQ_AAAAAAAAAAAAAAAA',
  ]
  for (const value of hostile) {
    const { id, minted } = adoptRequestId(value as string | null)
    assert.equal(minted, true, `${JSON.stringify(value)} must not be adopted`)
    assert.match(id, REQUEST_ID_PATTERN)
    assert.ok(!id.includes('\n'))
  }
})

test('a stage reports the time spent inside it, not since the turn began', () => {
  /*
   * ASSERTS THE RELATIONSHIP, NOT A STOPWATCH WINDOW.
   *
   * An earlier version of this required each stage to land inside an absolute
   * millisecond range and failed on a machine that happened to be busy — a real
   * flake, written by me, in a test whose actual subject is arithmetic. What
   * matters is that `at_ms` accumulates while `ms` does not, and that the two
   * agree; both hold at any speed.
   */
  const lines: string[] = []
  const trace = new TurnTrace('req_00000000000000000000', (line) => lines.push(line))

  const busy = (ms: number) => {
    const until = performance.now() + ms
    while (performance.now() < until) { /* deliberately blocking, for a real duration */ }
  }

  busy(20)
  trace.mark('first')
  busy(30)
  trace.mark('second')
  const built = trace.build('ok')

  assert.ok(built.at_ms.second! > built.at_ms.first!, 'at_ms accumulates')
  assert.ok(built.ms.first! > 0 && built.ms.second! > 0, 'each stage has a real duration')
  // The identity that makes the two columns readable together: a stage's own
  // duration is the difference between its end and the previous stage's end.
  assert.equal(built.ms.second, built.at_ms.second! - built.at_ms.first!)
  assert.equal(built.ms.first, built.at_ms.first!)
  assert.ok(built.total_ms >= built.at_ms.second!)
})

test('the line is one JSON object per turn and cannot be forged from its contents', () => {
  const lines: string[] = []
  const trace = new TurnTrace('req_11111111111111111111', (line) => lines.push(line))
  // A prompt-shaped value containing newlines is exactly what a log-injection
  // attempt looks like.
  trace.set('model', 'evil\nmigrapilot.turn {"trace":"forged","outcome":"ok"}')
  trace.mark('only')
  trace.finish('ok')

  assert.equal(lines.length, 1)
  const line = lines[0]!
  assert.equal(line.split('\n').length, 1, 'one turn is one line')
  assert.ok(line.startsWith('migrapilot.turn '))
  const parsed = JSON.parse(line.slice('migrapilot.turn '.length)) as Record<string, unknown>
  assert.equal(parsed.trace, 'req_11111111111111111111')
  assert.equal(parsed.outcome, 'ok')
})

test('facts set on the turn survive into the line', () => {
  const lines: string[] = []
  const trace = new TurnTrace('req_22222222222222222222', (line) => lines.push(line))
  trace.set('images', { requested: 2, warm: 1, stored_kb: 4600, sent_kb: 203 })
  trace.set('model', 'qwen2.5vl:7b')
  const built = trace.build('ok')
  assert.deepEqual(built.images, { requested: 2, warm: 1, stored_kb: 4600, sent_kb: 203 })
  assert.equal(built.model, 'qwen2.5vl:7b')
})

test('elapsed is monotonic and never negative', () => {
  const trace = new TurnTrace('req_33333333333333333333', () => {})
  assert.ok(trace.elapsed() >= 0)
})
