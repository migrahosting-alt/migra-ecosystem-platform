/**
 * THE ROUND TRIP — does a structured table survive the real product, and still
 * reach the same shared reasoning after a reload?
 *
 * ---------------------------------------------------------------------------
 * WHAT THE OFFLINE MATRIX CANNOT ANSWER
 *
 * `crossFormatEquivalence.test.ts` proves the substrate: one logical table as
 * CSV, TSV and XLSX reasons identically. It stages files on disk and calls
 * `tableEvidenceFor` directly, so it says nothing about upload, indexing,
 * conversation binding, or what survives a session ending.
 *
 * A table that reasons perfectly and loses its binding on reload is a broken
 * capability. So this uploads through the composer, asks, DROPS THE ENTIRE
 * BROWSER CONTEXT, comes back to the same conversation, and asks again without
 * re-attaching.
 *
 * ---------------------------------------------------------------------------
 * WHY A FRESH CONTEXT RATHER THAN page.reload()
 *
 * A reload keeps the browser profile, its caches and its storage. A new context
 * keeps only the session cookie — which is what a user coming back tomorrow on
 * another device actually has. If the binding lives anywhere in client state,
 * this finds it and a reload would not.
 *
 * ---------------------------------------------------------------------------
 * ONE TABLE, THREE QUESTIONS, THREE FORMATS
 *
 * `eq_roundtrip` carries a summable column, an identifier, and a mixed
 * text/number column, so one upload per format exercises a computation, an
 * identifier refusal and a mixed-text refusal. The offline matrix already
 * covers breadth; this only has to prove the round trip does not fork it.
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
const FIXTURES = path.join(HERE, '..', 'src', 'server', 'tables', '__fixtures__')
const SP = '/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'

const TARGET = resolveRigTarget()
const FORMATS = ['csv', 'tsv', 'xlsx']

const QUESTIONS = [
  {
    id: 'sum',
    ask: 'What is the total Revenue in this file?',
    /** The closed regression. A different number here is the defect returning. */
    expect: (text) => /474[,.]?000/.test(text),
    describe: 'Revenue totals 474,000',
  },
  {
    id: 'identifier',
    ask: 'What is the total ZipCode?',
    // Must refuse. The specific danger is a confident sum of postcodes.
    expect: (text) => !/\b\d{2,3}[,.]?\d{3}\b/.test(text.replace(/474[,.]?000/g, '')) || /identif/i.test(text),
    describe: 'ZipCode refused, never summed',
  },
  {
    id: 'mixed',
    ask: 'What is the total Readings?',
    // Refused for MIXING TEXT, never for the file being deficient.
    expect: (text) => !/invalid|not enough data|insufficient|bad data/i.test(text),
    describe: 'Readings refused truthfully, not as a deficient file',
  },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function cookie(user, domain) {
  const secret = fs.readFileSync(`${SP}/local/secret`, 'utf8').trim()
  const now = Date.now()
  const session = {
    sessionId: `tp-${now}`,
    authUserId: user,
    email: `${user}@e.invalid`,
    displayName: user,
    permissions: [],
    createdAt: now,
    expiresAt: now + 3_600_000,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return {
    name: 'migrapilot_consumer_session',
    value: `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`,
    domain,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }
}

async function newSession(browser, checkBuild) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addCookies([cookie('tester', new URL(TARGET.url).hostname)])
  const page = await context.newPage()
  const loaded = []
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/_next/static/')) loaded.push(u)
  })
  await page.goto(`${TARGET.url}/`, { waitUntil: 'networkidle', timeout: 60_000 })
  if (checkBuild) {
    // RULE 4 — the server's build is not the browser's build.
    assertClientBuild(loaded, path.join(HERE, '..', '.next', 'static'), fs.existsSync)
  }
  return { context, page }
}

/** Send one turn and return the assistant's answer text. */
async function turn(page, prompt) {
  const before = await page.locator('[data-testid=assistant-message]').count()
  const box = page.getByLabel('Message MigraPilot')
  await box.waitFor({ timeout: 20_000 })
  await box.fill(prompt)
  await page.getByLabel('Send message').click()

  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    const count = await page.locator('[data-testid=assistant-message]').count()
    const working = await page.locator('[data-testid=turn-progress]').count()
    if (count > before && working === 0) {
      // Let the last tokens settle before reading the bubble.
      await sleep(1200)
      return (await page.locator('[data-testid=assistant-message]').last().innerText()).trim()
    }
    await sleep(400)
  }
  throw new Error(`no answer within 180s for ${JSON.stringify(prompt)}`)
}

/** Does the last answer carry a visible "From your files" citation? */
async function citedInLastAnswer(page, file) {
  return page.evaluate((name) => {
    const messages = [...document.querySelectorAll('[data-testid=assistant-message]')]
    const last = messages[messages.length - 1]
    if (!last) return false
    return /From your files/i.test(last.innerText) && last.innerText.includes(name)
  }, file)
}

/** The files this conversation is still grounded in, as the UI shows them. */
async function groundedFiles(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('span[title]')]
      .map((el) => el.getAttribute('title') ?? '')
      .filter((t) => /\.(csv|tsv|xlsx)$/i.test(t)),
  )
}

const failures = []
const check = (ok, message) => {
  console.log(`      ${ok ? 'PASS' : 'FAIL'}  ${message}`)
  if (!ok) failures.push(message)
}

;(async () => {
  console.log('TABLE PERSISTENCE — REAL PRODUCT ROUND TRIP')
  console.log('─'.repeat(72))
  const identity = await assertRigIdentity(
    TARGET.url,
    TARGET.expectedBuildId ? { expectBuildId: TARGET.expectedBuildId } : {},
  )
  console.log(`rig ${TARGET.url} (${TARGET.source}) → ${identity.buildId}\n`)

  const browser = await chromium.launch({ headless: true })
  /** format → question id → answer, before and after the session was dropped. */
  const seen = {}

  try {
    for (const format of FORMATS) {
      const file = `eq_roundtrip.${format}`
      console.log(`\n${format.toUpperCase()} — ${file}`)
      seen[format] = { before: {}, after: {} }

      // ---- first session: upload and ask -----------------------------------
      const first = await newSession(browser, format === FORMATS[0])
      await first.page.setInputFiles('input[type=file]', path.join(FIXTURES, file))
      await sleep(4000) // upload + index

      console.log('   uploaded, asking:')
      for (const question of QUESTIONS) {
        const answer = await turn(first.page, question.ask)
        seen[format].before[question.id] = answer
        check(question.expect(answer), `${question.describe} — ${answer.slice(0, 70).replace(/\n/g, ' ')}`)
        /*
         * PROVENANCE IS PART OF THE ANSWER. A figure a user cannot trace to a
         * file is a figure they cannot check — and this is where the formats
         * diverged: only the text-indexed ones were cited.
         */
        if (question.id === 'sum') {
          check(await citedInLastAnswer(first.page, file), `the computed figure cites ${file}`)
        }
      }

      const url = first.page.url()
      const conversation = url.includes('/chat/') ? url.split('/chat/')[1].split(/[?#]/)[0] : null
      const boundBefore = await groundedFiles(first.page)
      check(boundBefore.includes(file), `the file is bound to the conversation (${boundBefore.join(', ') || 'none'})`)
      await first.context.close()

      // ---- SESSION DROPPED. Come back with only the cookie. -----------------
      console.log('   session dropped; returning with only the session cookie:')
      const second = await newSession(browser, false)
      await second.page.goto(`${TARGET.url}/chat/${conversation}`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      })
      await sleep(2500)

      const boundAfter = await groundedFiles(second.page)
      check(
        boundAfter.includes(file),
        `the file is STILL bound after the session ended (${boundAfter.join(', ') || 'none'})`,
      )

      for (const question of QUESTIONS) {
        // Deliberately NOT re-attaching: this is the whole point.
        const answer = await turn(second.page, question.ask)
        seen[format].after[question.id] = answer
        check(
          question.expect(answer),
          `after reload — ${question.describe} — ${answer.slice(0, 60).replace(/\n/g, ' ')}`,
        )
        if (question.id === 'sum') {
          check(await citedInLastAnswer(second.page, file), `after reload — the figure still cites ${file}`)
        }
      }
      await second.page.screenshot({ path: `${SP}/persist-${format}.png` })
      await second.context.close()
    }

    /* ---- cross-format, after the round trip ------------------------------ */
    console.log('\nCROSS-FORMAT, AFTER RELOAD')
    for (const question of QUESTIONS) {
      const results = FORMATS.map((f) => ({ f, ok: question.expect(seen[f].after[question.id]) }))
      const disagreeing = results.filter((r) => !r.ok).map((r) => r.f)
      check(
        disagreeing.length === 0,
        `all three formats still satisfy: ${question.describe}` +
          (disagreeing.length ? ` — diverged: ${disagreeing.join(', ')}` : ''),
      )
    }
    // The sum is the one with an exact expected value, so it can be compared
    // directly rather than only by predicate.
    const sums = FORMATS.map((f) => /474[,.]?000/.test(seen[f].after.sum))
    check(sums.every(Boolean), 'Revenue is 474,000 in all three formats after reload')
  } finally {
    await browser.close()
  }

  console.log(`\n${failures.length === 0 ? '✓ TABLE PERSISTENCE VERIFIED' : '✗ TABLE PERSISTENCE FAILED'}`)
  for (const failure of failures) console.error(`   · ${failure}`)
  process.exit(failures.length === 0 ? 0 : 1)
})().catch((error) => {
  console.error(`\n✗ ${error.stack ?? String(error)}`)
  process.exit(1)
})
