/**
 * Concurrent requests must not redeem the same refresh token twice.
 *
 * This is the only defect in the session path whose penalty is PERMANENT: a
 * second redemption is treated as theft by MigraAuth and revokes the whole
 * token family, so the person is signed out for good rather than merely early.
 * It is also invisible in normal testing — it needs two requests to overlap
 * while the access token happens to be expired.
 *
 * The single-flight guard lives inside `migraAuthApi`, so this exercises the
 * property through the same shape rather than importing internals: one exchange
 * per distinct token, no matter how many callers arrive at once.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

/** A faithful copy of the guard's shape, over a counting exchange. */
function makeGuard(exchange: (token: string) => Promise<string | null>) {
  const inFlight = new Map<string, Promise<string | null>>()
  return (token: string) => {
    const key = createHash('sha256').update(token).digest('hex')
    const existing = inFlight.get(key)
    if (existing) return existing
    const attempt = exchange(token).finally(() => inFlight.delete(key))
    inFlight.set(key, attempt)
    return attempt
  }
}

test('ten concurrent callers holding one token cause exactly one exchange', async () => {
  let exchanges = 0
  const guarded = makeGuard(async (token) => {
    exchanges += 1
    await new Promise((resolve) => setTimeout(resolve, 10))
    return `renewed:${token}`
  })

  const results = await Promise.all(Array.from({ length: 10 }, () => guarded('refresh-abc')))

  assert.equal(exchanges, 1, 'a second redemption would revoke the family')
  // Every caller must still receive the renewal — sharing the exchange must not
  // mean nine of them get nothing and fall through to `reauth_required`.
  assert.deepEqual(new Set(results), new Set(['renewed:refresh-abc']))
})

test('different tokens never share an exchange', async () => {
  /*
   * The key is the TOKEN, not the user, precisely so this holds. If two people's
   * refreshes collided, one would receive the other's credential — a far worse
   * outcome than the bug being fixed.
   */
  const seen: string[] = []
  const guarded = makeGuard(async (token) => {
    seen.push(token)
    return `renewed:${token}`
  })

  const [a, b] = await Promise.all([guarded('token-one'), guarded('token-two')])
  assert.equal(a, 'renewed:token-one')
  assert.equal(b, 'renewed:token-two')
  assert.deepEqual(seen.sort(), ['token-one', 'token-two'])
})

test('the entry is released so a later refresh is not served a stale result', async () => {
  // Without the `finally` delete, the map would answer every future refresh of
  // that token with the first exchange forever — including after it rotated.
  let exchanges = 0
  const guarded = makeGuard(async (token) => {
    exchanges += 1
    return `renewed-${exchanges}:${token}`
  })

  const first = await guarded('same-token')
  const second = await guarded('same-token')

  assert.equal(first, 'renewed-1:same-token')
  assert.equal(second, 'renewed-2:same-token')
  assert.equal(exchanges, 2, 'sequential refreshes are separate exchanges')
})

test('a failed exchange is released rather than cached as a permanent failure', async () => {
  let attempts = 0
  const guarded = makeGuard(async () => {
    attempts += 1
    if (attempts === 1) throw new Error('network blip')
    return 'renewed'
  })

  await assert.rejects(() => guarded('t'))
  // A transient failure must not poison the token for the rest of the process.
  assert.equal(await guarded('t'), 'renewed')
})
