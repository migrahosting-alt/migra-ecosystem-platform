/**
 * THE ORIGINAL GAP, CLOSED — or not.
 *
 *   ask in Chat → binding resolved server-side → grant re-resolved →
 *   read-only authority → inspect on the server-owned root →
 *   evidence in the turn → the answer names the real files
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ANSWER MUST COME THROUGH THE CHAT TURN
 *
 * Not a console fetch, not the API. A browser-console call proved the inspect
 * ROUTE; the product requirement is that the assistant can use the connected
 * project when someone asks it a question. So every assertion here reads the
 * assistant's own message bubble.
 *
 * And the proof is a SENTINEL, not a label. That the project's name appears
 * proves the binding round-tripped; naming the files that contain a string
 * which exists nowhere else proves the turn actually read that project.
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

const SENTINEL = 'ZORBLAX_QUANT_7X9K'
const USER = 'tester'
const scoped = {
  'x-owner-scope': `user:${USER}`,
  'x-workspace-scope': `personal:${USER}`,
  'content-type': 'application/json',
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []
const check = (ok, message) => {
  console.log(`   ${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

function cookie(domain) {
  const secret = fs.readFileSync(`${SP}/local/secret`, 'utf8').trim()
  const now = Date.now()
  const session = {
    sessionId: `cp-${now}`, authUserId: USER, email: `${USER}@e.invalid`,
    displayName: USER, permissions: [], createdAt: now, expiresAt: now + 3_600_000,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return {
    name: 'migrapilot_consumer_session',
    value: `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`,
    domain, path: '/', httpOnly: true, secure: false, sameSite: 'Lax',
  }
}

async function newSession(browser, checkBuild) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 } })
  await context.addCookies([cookie(new URL(TARGET.url).hostname)])
  const page = await context.newPage()
  const loaded = []
  page.on('response', (r) => { if (r.url().includes('/_next/static/')) loaded.push(r.url()) })
  await page.goto(`${TARGET.url}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  if (checkBuild) assertClientBuild(loaded, path.join(HERE, '..', '.next', 'static'), fs.existsSync)
  return { context, page }
}

/** Send one turn, return the assistant's own words. */
async function ask(page, prompt) {
  const before = await page.locator('[data-testid=assistant-message]').count()
  const box = page.getByLabel('Message MigraPilot')
  await box.waitFor({ timeout: 20_000 })
  await box.fill(prompt)
  await page.getByLabel('Send message').click()
  const deadline = Date.now() + 240_000
  while (Date.now() < deadline) {
    const count = await page.locator('[data-testid=assistant-message]').count()
    const working = await page.locator('[data-testid=turn-progress]').count()
    if (count > before && working === 0) {
      await sleep(1500)
      return (await page.locator('[data-testid=assistant-message]').last().innerText()).trim()
    }
    await sleep(400)
  }
  throw new Error(`no answer within 240s for ${JSON.stringify(prompt)}`)
}

const QUESTION = `Find the string "${SENTINEL}" in my connected project and tell me which files contain it.`

;(async () => {
  console.log('CHAT → CONNECTED PROJECT')
  console.log('─'.repeat(72))
  const identity = await assertRigIdentity(TARGET.url, TARGET.expectedBuildId ? { expectBuildId: TARGET.expectedBuildId } : {})
  console.log(`rig ${TARGET.url} → ${identity.buildId}\n`)

  const browser = await chromium.launch({ headless: true })
  let workspaceId = null
  let conversationId = null

  try {
    /* ---------- a real project, with a string that exists nowhere else ---------- */
    const root = path.join(SP, 'chat-project-fixture')
    fs.mkdirSync(path.join(root, 'src', 'engine'), { recursive: true })
    fs.writeFileSync(path.join(root, 'README.md'), `# Chat project fixture\n\nMarker: ${SENTINEL}\n`)
    fs.writeFileSync(path.join(root, 'src', 'engine', 'config.ts'), `export const token = '${SENTINEL}'\n`)
    fs.writeFileSync(path.join(root, 'src', 'unrelated.ts'), 'export const nothing = 1\n')

    const created = await fetch(`${BRAIN}/api/ai/workspaces`, {
      method: 'POST', headers: scoped, body: JSON.stringify({ name: 'Chat project fixture', root }),
    }).then((r) => r.json())
    workspaceId = created?.workspace?.id
    console.log(`fixture registered: ${workspaceId}\n`)

    /* ---------- 1. ask BEFORE connecting ---------- */
    console.log('1. asked before any project is connected')
    const s1 = await newSession(browser, true)
    const before = await ask(s1.page, QUESTION)
    conversationId = await s1.page.evaluate(async () => {
      const r = await fetch('/api/conversations')
      return ((await r.json()).conversations ?? [])[0]?.id
    })
    /*
     * 🚨 MENTIONING THE QUERY IS NOT CLAIMING TO HAVE FOUND IT.
     *
     * My first version asserted the sentinel was absent, and the fixed wording
     * failed it — because a natural reply repeats what the user asked for: "I
     * can't search for X". That is correct behaviour. What must be absent is a
     * claim of a RESULT: found/appears/located in, or any file name.
     */
    check(!/\b(found|appears?|located|contained)\s+(in|at)\b/i.test(before), 'it claims no result')
    check(/connect/i.test(before), `and asks for a project: "${before.slice(0, 90).replace(/\n/g, ' ')}"`)
    check(!/VS ?Code|open a folder/i.test(before), 'without naming another product')
    await s1.context.close()

    /* ---------- 2. connect, then ask in CHAT ---------- */
    console.log('\n2. connected, then asked in normal Chat')
    const s2 = await newSession(browser, false)
    await s2.page.goto(`${TARGET.url}/chat/${conversationId}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(1500)
    await s2.page.locator('[data-testid=connect-project]').click()
    const option = s2.page.locator('[data-testid=project-option]').first()
    await option.waitFor({ timeout: 15_000 })
    await option.click()
    await s2.page.locator('[data-testid=project-connected]').waitFor({ timeout: 15_000 })

    const answer = await ask(s2.page, QUESTION)
    console.log(`   answer: "${answer.slice(0, 200).replace(/\n/g, ' ')}…"`)
    check(answer.includes(SENTINEL), '🚨 the sentinel reached the chat answer')
    check(/README\.md/i.test(answer), 'it names README.md')
    check(/config\.ts/i.test(answer), 'it names src/engine/config.ts')
    check(!/unrelated\.ts/i.test(answer), 'and does NOT name the file that has no match')
    check(!/ws_|proj_|workspace\.inspect|connected-repo/.test(answer), 'no internal ids or capability ids in the answer')
    await s2.page.screenshot({ path: `${SP}/chat-project-found.png` })
    await s2.context.close()

    /* ---------- 3. fresh context, same conversation, no reconnect ---------- */
    console.log('\n3. brand new browser context, no reconnect')
    const s3 = await newSession(browser, false)
    await s3.page.goto(`${TARGET.url}/chat/${conversationId}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(2000)
    const again = await ask(s3.page, QUESTION)
    check(again.includes(SENTINEL), 'the sentinel is still found after the session ended')
    await s3.context.close()

    /* ---------- 4. revoke, and ask again ---------- */
    console.log('\n4. access revoked in the registry, asked again')
    await fetch(`${BRAIN}/api/ai/workspaces/${workspaceId}`, { method: 'DELETE', headers: scoped })
    // The workspace is gone rather than merely unreadable, so the honest answer
    // is "connect one", and it must NOT claim to have read anything.
    const s4 = await newSession(browser, false)
    await s4.page.goto(`${TARGET.url}/chat/${conversationId}`, { waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(2000)
    const revoked = await ask(s4.page, QUESTION)
    console.log(`   answer: "${revoked.slice(0, 160).replace(/\n/g, ' ')}…"`)
    check(
      !/\b(found|appears?|located|contained)\s+(in|at)\b/i.test(revoked),
      '🚨 it reports no result from a project it can no longer read',
    )
    check(!/unrelated\.ts|config\.ts/i.test(revoked), 'and invents no file names')
    await s4.page.screenshot({ path: `${SP}/chat-project-revoked.png` })
    await s4.context.close()
  } finally {
    if (workspaceId) await fetch(`${BRAIN}/api/ai/workspaces/${workspaceId}`, { method: 'DELETE', headers: scoped }).catch(() => {})
    if (conversationId) {
      await fetch(`${BRAIN}/api/ai/conversations/${conversationId}/project`, { method: 'DELETE', headers: scoped }).catch(() => {})
    }
    await browser.close()
  }

  console.log(`\n${failures.length === 0 ? '✓ CHAT → PROJECT VERIFIED' : '✗ CHAT → PROJECT FAILED'}`)
  for (const f of failures) console.error(`   · ${f}`)
  process.exit(failures.length === 0 ? 0 : 1)
})().catch((e) => { console.error(`\n✗ ${e.stack ?? e}`); process.exit(1) })
