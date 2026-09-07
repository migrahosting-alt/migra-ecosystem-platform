/**
 * CONNECT PROJECT, THROUGH THE REAL UI.
 *
 *   no project → Connect project → choose → bind → connected context shown →
 *   inspect reads THE SELECTED PROJECT → reload → still bound
 *
 * ---------------------------------------------------------------------------
 * 🚨 A LABEL IN THE UI IS NOT PROOF THE RIGHT PROJECT WAS READ
 *
 * The control shows whatever the server said the project is called. That the
 * name appears proves the binding round-tripped; it proves nothing about what
 * an inspection would actually open. So the acceptance is a SENTINEL: a string
 * that exists only inside the fixture, searched for through the bound project.
 * If it comes back, the inspect read that project and not "some directory".
 *
 * ---------------------------------------------------------------------------
 * The empty state runs FIRST, on the account as it stands, because an empty
 * list is real product behaviour and not a failure to work around.
 * ---------------------------------------------------------------------------
 */

import { chromium } from '/home/bonex/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertRigIdentity } from './assert-rig-identity.js'
import { assertClientBuild, resolveRigTarget } from './rigTarget.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SP = '/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'
const TARGET = resolveRigTarget()
const BRAIN = process.env.MIGRAPILOT_BRAIN_URL
if (!BRAIN) {
  console.error('MIGRAPILOT_BRAIN_URL is not set. This harness does not guess its target.')
  process.exit(1)
}

const SENTINEL = 'MIGRAPILOT_UI_CONNECT_SENTINEL_4B8E2D'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []
const check = (ok, message) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

function cookie(user, domain) {
  const secret = fs.readFileSync(`${SP}/local/secret`, 'utf8').trim()
  const now = Date.now()
  const session = {
    sessionId: `pc-${now}`, authUserId: user, email: `${user}@e.invalid`,
    displayName: user, permissions: [], createdAt: now, expiresAt: now + 3_600_000,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return {
    name: 'migrapilot_consumer_session',
    value: `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`,
    domain, path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }
}

/*
 * 🚨 THE SCOPE THE CONSUMER ACTUALLY USES, not one this harness picked.
 *
 * My first run registered the fixture under 'tester'/'default' and the chooser
 * was empty — correctly. The consumer DERIVES its Brain scope from the session
 * (`user:<id>` / `personal:<id>`) and never accepts one from a caller, which
 * is the tenancy guarantee working exactly as intended. A harness that
 * registers somewhere else is testing a different tenant.
 */
const USER = 'tester'
const scoped = {
  'x-owner-scope': `user:${USER}`,
  'x-workspace-scope': `personal:${USER}`,
  'content-type': 'application/json',
}

async function newSession(browser, checkBuild) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  await context.addCookies([cookie(USER, new URL(TARGET.url).hostname)])
  const page = await context.newPage()
  const loaded = []
  page.on('response', (r) => { if (r.url().includes('/_next/static/')) loaded.push(r.url()) })
  await page.goto(`${TARGET.url}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  if (checkBuild) assertClientBuild(loaded, path.join(HERE, '..', '.next', 'static'), fs.existsSync)
  return { context, page }
}

/** Start a conversation, so the rail (and its control) exists. */
async function conversation(page) {
  const box = page.getByLabel('Message MigraPilot')
  await box.waitFor({ timeout: 20_000 })
  await box.fill(`project connect ${Date.now()}`)
  await page.getByLabel('Send message').click()
  await page.waitForURL(/\/chat\//, { timeout: 90_000 })
  for (let i = 0; i < 40; i += 1) {
    const list = await page.evaluate(async () => {
      const res = await fetch('/api/conversations')
      return ((await res.json().catch(() => ({}))).conversations ?? [])
    })
    if (list.length) return list[0].id
    await sleep(500)
  }
  throw new Error('no durable conversation appeared')
}

;(async () => {
  console.log('CONNECT PROJECT — REAL UI')
  console.log('─'.repeat(72))
  const identity = await assertRigIdentity(TARGET.url, TARGET.expectedBuildId ? { expectBuildId: TARGET.expectedBuildId } : {})
  console.log(`rig ${TARGET.url} (${TARGET.source}) → ${identity.buildId}\n`)

  const browser = await chromium.launch({ headless: true })
  let workspaceId = null

  try {
    /* ---------- 1. EMPTY STATE, on the account as it stands ---------- */
    console.log('1. empty state')
    const first = await newSession(browser, true)
    const convId = await conversation(first.page)
    await sleep(1500)

    await first.page.locator('[data-testid=connect-project]').waitFor({ timeout: 15_000 })
    check(true, 'a Connect project control is offered')
    await first.page.locator('[data-testid=connect-project]').click()
    await first.page.locator('[data-testid=project-chooser]').waitFor({ timeout: 10_000 })
    /*
     * WAIT FOR THE ANSWER, do not race it. The first version counted the empty
     * state the instant the chooser appeared, while it still said "Loading your
     * projects…" — and reported a product failure that was mine.
     */
    await first.page
      .locator('[data-testid=project-empty], [data-testid=project-option]')
      .first()
      .waitFor({ timeout: 15_000 })
    const emptyShown = await first.page.locator('[data-testid=project-empty]').count()
    check(emptyShown === 1, 'the chooser shows a truthful empty state, not an empty list')
    const emptyText = emptyShown ? await first.page.locator('[data-testid=project-empty]').innerText() : ''
    check(/no projects are available/i.test(emptyText), `and says so: "${emptyText.trim()}"`)
    await first.page.screenshot({ path: `${SP}/connect-empty.png` })
    await first.context.close()

    /* ---------- 2. a real project, registered the real way ---------- */
    console.log('\n2. registering one real workspace')
    const root = path.join(SP, 'ui-connect-fixture')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'SENTINEL.md'), `# UI connect fixture\n\n${SENTINEL}\n`)
    fs.writeFileSync(path.join(root, 'src', 'marker.ts'), `export const marker = '${SENTINEL}'\n`)

    const created = await fetch(`${BRAIN}/api/ai/workspaces`, {
      method: 'POST', headers: scoped,
      body: JSON.stringify({ name: 'UI connect fixture', root }),
    }).then((r) => r.json())
    workspaceId = created?.workspace?.id
    check(Boolean(workspaceId), `registered through the real route (${workspaceId})`)

    /* ---------- 3. the chain, through the control ---------- */
    console.log('\n3. connect through the UI')
    const second = await newSession(browser, false)
    await second.page.goto(`${TARGET.url}/chat/${convId}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(1500)
    await second.page.locator('[data-testid=connect-project]').click()
    const option = second.page.locator('[data-testid=project-option]').first()
    await option.waitFor({ timeout: 15_000 })
    check((await option.innerText()).includes('UI connect fixture'), 'the authorized project is listed by label')
    await option.click()

    const connected = second.page.locator('[data-testid=project-connected]')
    await connected.waitFor({ timeout: 15_000 })
    check(true, 'the conversation shows its connected project context')
    const shown = await connected.innerText()
    check(!/ws_|proj_|connected-repo|platform-project/.test(shown), `no internal ids in the control: "${shown.trim()}"`)
    await second.page.screenshot({ path: `${SP}/connect-connected.png` })

    /* ---------- 4. 🚨 the sentinel: did it read THAT project? ---------- */
    console.log('\n4. inspect — the sentinel, not the label')
    const inspected = await second.page.evaluate(
      async ([id, needle]) => {
        const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/inspect`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'search', query: needle }),
        })
        return { status: res.status, body: await res.json().catch(() => ({})) }
      },
      [convId, SENTINEL],
    )
    const matches = JSON.stringify(inspected.body?.data?.matches ?? [])
    check(inspected.status === 200 && matches.includes(SENTINEL),
      `inspect read the SELECTED project — sentinel found in ${(inspected.body?.data?.matches ?? []).length} file(s)`)

    /* ---------- 5. reload: still bound, from the server ---------- */
    console.log('\n5. reload — a brand new browser context')
    await second.context.close()
    const third = await newSession(browser, false)
    await third.page.goto(`${TARGET.url}/chat/${convId}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(2000)
    const stillConnected = third.page.locator('[data-testid=project-connected]')
    await stillConnected.waitFor({ timeout: 15_000 })
    check((await stillConnected.innerText()).includes('UI connect fixture'),
      'still bound after the session ended, with no reconnect')

    const again = await third.page.evaluate(
      async ([id, needle]) => {
        const res = await fetch(`/api/conversations/${encodeURIComponent(id)}/inspect`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ op: 'search', query: needle }),
        })
        return { status: res.status, body: await res.json().catch(() => ({})) }
      },
      [convId, SENTINEL],
    )
    check(again.status === 200 && JSON.stringify(again.body?.data?.matches ?? []).includes(SENTINEL),
      'and inspect still reads it after the reload')
    await third.page.screenshot({ path: `${SP}/connect-reloaded.png` })
    await third.context.close()
  } finally {
    /* ---------- cleanup: no mystery projects left in the tester scope ---------- */
    if (workspaceId) {
      await fetch(`${BRAIN}/api/ai/workspaces/${workspaceId}`, { method: 'DELETE', headers: scoped }).catch(() => {})
    }
    await browser.close()
  }

  console.log(`\n${failures.length === 0 ? '✓ CONNECT PROJECT VERIFIED' : '✗ CONNECT PROJECT FAILED'}`)
  for (const f of failures) console.error(`   · ${f}`)
  process.exit(failures.length === 0 ? 0 : 1)
})().catch((e) => { console.error(`\n✗ ${e.stack ?? e}`); process.exit(1) })
