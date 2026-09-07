/**
 * CASES 3, 4 and 10 of the rename acceptance matrix — the three the existing
 * harnesses do NOT cover.
 *
 *   3.  duplicate dispatch          → exactly ONE mutation
 *   4.  the requested title changed → the old approval is refused
 *   10. an approval cannot survive in a way that permits REPLAY
 *
 * ---------------------------------------------------------------------------
 * WHY "A SECOND RENAME WORKS" IS NOT EVIDENCE FOR ANY OF THESE
 *
 * `verify-rename-approval.cjs` proves a second rename, proposed and approved
 * afresh, applies. That is the happy path twice. It says nothing about what
 * happens to a token that was already spent, bound to different input, or sent
 * twice at once — which are the three ways a consent protocol leaks a duplicate
 * side effect, and the reason the token is single-use and input-bound at all.
 *
 * ---------------------------------------------------------------------------
 * DRIVEN FROM THE BROWSER, AS THE SIGNED-IN USER
 *
 * Two of these cannot be produced by clicking: the UI never offers a spent
 * token back, and it re-proposes when the title changes. So they are issued
 * with `fetch` FROM THE PAGE — same origin, same session cookie, same routes
 * the UI calls. That is the product's own API answering a real signed-in
 * browser, not an engine-level unit test standing in for one.
 *
 * Case 3 is done BOTH ways: a real double click, and two concurrent dispatches.
 * The click proves the control does not permit it; the concurrent pair proves
 * the BACKEND does not — and only the second is worth anything, because a
 * disabled button is a convenience and the single-use token is the mechanism.
 * ---------------------------------------------------------------------------
 */
const { chromium } = require('/home/bonex/.npm/_npx/420ff84f11983ee5/node_modules/playwright')
const { assertRigIdentity } = require('./assert-rig-identity.cjs')
const { resolveRigTarget, assertClientBuild } = require('./rigTarget.cjs')
const crypto = require('node:crypto')
const fs = require('node:fs')

const SP = '/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'
const SECRET = fs.readFileSync(`${SP}/local/secret`, 'utf8').trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cookie(user, domain) {
  const n = Date.now()
  const s = { sessionId: 'rp-' + n, authUserId: user, email: user + '@e.invalid', displayName: user, permissions: [], createdAt: n, expiresAt: n + 3600000 }
  const p = Buffer.from(JSON.stringify(s)).toString('base64url')
  return { name: 'migrapilot_consumer_session', value: `${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('hex')}`, domain, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }
}

/** Ask the product's own API, from the page, with the page's session. */
const api = (page, id, body) =>
  page.evaluate(
    async ([conversationId, payload]) => {
      const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/rename-approval`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return { status: res.status, body: await res.json().catch(() => ({})) }
    },
    [id, body],
  )

/**
 * 🚨 THE URL CARRIES THE OPTIMISTIC ID, NOT THE DURABLE ONE.
 *
 * A new chat is sent under a client-side `chat-<ts>-<n>` id and the Brain names
 * it `conv_…` a moment later. My first version read the id out of `page.url()`
 * and every dispatch came back "That conversation could not be found" — the
 * product was right and the harness was asking about a conversation that had
 * never existed server-side. There is also no `GET /api/conversations/:id`
 * (405); the list is the read side.
 */
const conversations = (page) =>
  page.evaluate(async () => {
    const res = await fetch('/api/conversations')
    const json = await res.json().catch(() => ({}))
    return json?.conversations ?? []
  })

const durableIdFor = async (page, title) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const found = (await conversations(page)).find((c) => c.title === title)
    if (found) return found.id
    await sleep(500)
  }
  throw new Error(`no durable conversation ever appeared with title ${JSON.stringify(title)}`)
}

const titleOf = async (page, id) => (await conversations(page)).find((c) => c.id === id)?.title ?? null

const results = []
const record = (n, name, pass, detail) => {
  results.push({ n, name, pass, detail })
  console.log(`${pass ? '  PASS' : '  FAIL'}  case ${n} — ${name}`)
  if (detail) console.log(`        ${detail}`)
}

;(async () => {
  const target = await resolveRigTarget()
  const RIG = target.url
  const identity = await assertRigIdentity(RIG, target.expectedBuildId ? { expectBuildId: target.expectedBuildId } : {})
  console.log(`rig target   : ${RIG} (${target.source})`)
  console.log(`rig identity : ${identity.buildId}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await context.addCookies([cookie('tester', new URL(RIG).hostname)])
  const page = await context.newPage()

  try {
    const loaded = []
    page.on('response', (res) => { const u = res.url(); if (u.includes('/_next/static/')) loaded.push(u) })
    await page.goto(`${RIG}/`, { waitUntil: 'networkidle', timeout: 60000 })
    const client = await assertClientBuild(loaded, require('node:path').join(__dirname, '..', '.next', 'static'), require('node:fs').existsSync)
    console.log(`client build : ${client.assets} assets, all from this build\n`)
    const box = page.getByLabel('Message MigraPilot')
    await box.waitFor({ timeout: 20000 })
    const SEED = `replay case ${Date.now()}`
    await box.fill(SEED)
    await page.getByLabel('Send message').click()
    await page.waitForURL(/\/chat\//, { timeout: 90000 })
    const id = await durableIdFor(page, SEED)
    console.log(`conversation : ${id}`)
    const original = await titleOf(page, id)
    console.log(`start title  : ${JSON.stringify(original)}\n`)

    /* ---------- CASE 4 — the requested title moved under the approval ------ */
    {
      const proposed = await api(page, id, { step: 'propose', title: 'Case 4 original' })
      const token = proposed.body?.approvalToken
      const sent = await api(page, id, { step: 'dispatch', approvalToken: token, title: 'Case 4 SUBSTITUTED' })
      const after = await titleOf(page, id)
      const refused = sent.body?.status !== 'done'
      const unchanged = after !== 'Case 4 SUBSTITUTED' && after !== 'Case 4 original'
      record(
        4,
        'approve, then change the requested title → old approval refused',
        refused && unchanged,
        `dispatch → ${sent.status} ${JSON.stringify(sent.body?.status)} · ${JSON.stringify(sent.body?.message)} · title now ${JSON.stringify(after)}`,
      )
    }

    /* ---------- CASE 3 — duplicate dispatch, exactly one mutation --------- */
    {
      const proposed = await api(page, id, { step: 'propose', title: 'Case 3 once' })
      const token = proposed.body?.approvalToken
      // Both in flight together: this is the refresh/double-click window.
      const [a, b] = await page.evaluate(
        async ([conversationId, tk]) => {
          const call = () =>
            fetch(`/api/conversations/${encodeURIComponent(conversationId)}/rename-approval`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ step: 'dispatch', approvalToken: tk, title: 'Case 3 once' }),
            }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }))
          return Promise.all([call(), call()])
        },
        [id, token],
      )
      const done = [a, b].filter((r) => r.body?.status === 'done')
      const after = await titleOf(page, id)
      record(
        3,
        'duplicate dispatch → exactly ONE mutation',
        done.length === 1 && after === 'Case 3 once',
        `${done.length} of 2 succeeded · other: ${JSON.stringify([a, b].find((r) => r.body?.status !== 'done')?.body?.message)} · title ${JSON.stringify(after)}`,
      )
    }

    /* ---------- CASE 10 — a spent approval cannot be replayed ------------- */
    {
      const proposed = await api(page, id, { step: 'propose', title: 'Case 10 first' })
      const token = proposed.body?.approvalToken
      const first = await api(page, id, { step: 'dispatch', approvalToken: token, title: 'Case 10 first' })
      // Rename to something else so a successful replay would be VISIBLE.
      const second = await api(page, id, { step: 'propose', title: 'Case 10 interim' })
      await api(page, id, { step: 'dispatch', approvalToken: second.body?.approvalToken, title: 'Case 10 interim' })
      // Now replay the FIRST, already-spent token.
      const replay = await api(page, id, { step: 'dispatch', approvalToken: token, title: 'Case 10 first' })
      const after = await titleOf(page, id)
      record(
        10,
        'a spent approval cannot be replayed',
        first.body?.status === 'done' && replay.body?.status !== 'done' && after === 'Case 10 interim',
        `replay → ${replay.status} ${JSON.stringify(replay.body?.status)} · ${JSON.stringify(replay.body?.message)} · title stayed ${JSON.stringify(after)}`,
      )
    }

    /* ---------- CASE 3b — the CONTROL also refuses a double click --------- */
    {
      await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
      await sleep(1500)
      await page.locator('[data-testid=conversation-menu]').first().click()
      await page.locator('[data-testid=menu-rename]').first().click()
      const input = page.locator('[data-testid=rename-input]')
      await input.waitFor({ timeout: 8000 })
      await input.fill('Case 3b double click')
      await page.locator('[data-testid=rename-save]').click()
      const approve = page.locator('[data-testid=rename-approve]')
      await approve.waitFor({ timeout: 10000 })
      await approve.click({ force: true })
      await approve.click({ force: true, timeout: 1500 }).catch(() => {})
      await sleep(3000)
      const after = await titleOf(page, id)
      record(
        '3b',
        'the Approve control cannot be clicked twice into a second mutation',
        after === 'Case 3b double click',
        `title ${JSON.stringify(after)}`,
      )
    }

    await page.screenshot({ path: `${SP}/rename-replay.png` })
  } finally {
    await browser.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) {
    console.error('FAILED: ' + failed.map((f) => `case ${f.n}`).join(', '))
    process.exit(1)
  }
})().catch((e) => {
  console.error(e.stack ?? String(e))
  process.exit(1)
})
