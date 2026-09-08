/**
 * COLD START, THROUGH THE REAL PRODUCT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AT ALL
 *
 * The unit suite for this defect matched `ChatProvider.tsx` as TEXT and passed
 * for as long as the defect was on screen. It could not have done otherwise: it
 * was asking whether a string reached the message data, and the defect was that
 * the string was RENDERED in the assistant's avatar and bubble. Only a real
 * browser against a real cold model can answer that.
 *
 * So this evicts the model for real, sends a real turn as a signed-in user, and
 * watches the DOM while the wait happens.
 *
 * ---------------------------------------------------------------------------
 * 🚨 AN UNOBSERVED COLD START IS NOT A PASS
 *
 * If the model happened to be warm, every assertion here would hold vacuously
 * and the run would print green having tested nothing. That is the false-green
 * shape this repository has been bitten by twice. So the run REQUIRES having
 * seen the cold-start line at least once, and reports INCONCLUSIVE — a failure
 * exit — when it did not.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE TARGET IS NEVER ASSUMED
 *
 * No port literal, and no fallback to one. The rig URL comes from the
 * environment and the rig must then PROVE its identity before a single sample
 * is collected; a missing or unrecognised identity is a hard stop. A port is
 * not an identity — this machine runs several products at once, and one of them
 * has already answered 200 to a harness that assumed otherwise.
 * ---------------------------------------------------------------------------
 */

import { chromium } from '/home/bonex/.npm/_npx/420ff84f11983ee5/node_modules/playwright/index.mjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { assertRigIdentity } from './assert-rig-identity.js'
import { assertClientBuild, resolveRigTarget } from './rigTarget.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * The product's own word for the cold-start condition — the OBSERVATION signal.
 *
 * It used to be the Brain's sentence, "Loading the language model …", because
 * the consumer displayed that sentence verbatim. It no longer does: the stream
 * boundary drops the Brain's prose and `state/turnStatus.ts` maps the stage
 * code to this. Left unchanged, this harness would have looked for a string
 * that can no longer appear and reported INCONCLUSIVE for ever — a guard that
 * silently stops being able to see its own subject.
 */
const COLD_START = 'Starting up'

/**
 * The sentence a user was actually shown in production, kept as the thing that
 * must NEVER appear — in the progress surface, in a message, or after a reload.
 *
 * Checked as a substring of the Brain's wording rather than the whole
 * paragraph, so a reworded variant of the same infrastructure talk is caught
 * too.
 */
const FORBIDDEN = ['Loading the language model', 'Loading the image model', 'image pipeline']
const SP = '/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'

const fail = (message) => {
  console.error(`\n✗ ${message}`)
  process.exit(1)
}

/** Required, and never defaulted. See the header. */
const need = (name) => {
  const value = process.env[name]
  if (!value) {
    fail(
      `${name} is not set.\n` +
        '  This harness does not guess its target and does not scan for one.\n' +
        `  Run it as: ${name}=<url> node scripts/verify-cold-start.mjs`,
    )
  }
  return value.replace(/\/$/, '')
}

const TARGET = resolveRigTarget()
const RIG = TARGET.url
const OLLAMA = need('OLLAMA_API_BASE')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function sessionCookie(user, domain) {
  const secret = fs.readFileSync(`${SP}/local/secret`, 'utf8').trim()
  const now = Date.now()
  const session = {
    sessionId: `cs-${now}`,
    authUserId: user,
    email: `${user}@e.invalid`,
    displayName: user,
    permissions: [],
    createdAt: now,
    expiresAt: now + 3_600_000,
  }
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return {
    name: 'migrapilot_consumer_session',
    value: `${payload}.${signature}`,
    domain,
    path: '/',
    httpOnly: true,
    secure: false,
    sameSite: 'Lax',
  }
}

/**
 * Evict the resident chat models so the next turn genuinely pays the load cost.
 *
 * `keep_alive: 0` is Ollama's own unload. NOTHING IS KILLED — no process is
 * signalled and no port is touched; the model reloads on its next use. That
 * distinction is the whole of the process-ownership rule.
 */
async function evictModels() {
  const ps = await fetch(`${OLLAMA}/api/ps`).then((r) => r.json())
  const resident = (ps.models ?? []).map((m) => m.name).filter((n) => !/embed/i.test(n))
  if (resident.length === 0) {
    console.log('   nothing resident — the next turn is cold already')
    return []
  }
  for (const model of resident) {
    await fetch(`${OLLAMA}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: 0 }),
    }).catch(() => {})
    console.log(`   evicted ${model}`)
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const now = await fetch(`${OLLAMA}/api/ps`).then((r) => r.json())
    const left = (now.models ?? []).filter((m) => !/embed/i.test(m.name))
    if (left.length === 0) return resident
    await sleep(500)
  }
  console.log('   ⚠ some models are still resident; the turn may not be cold')
  return resident
}

/**
 * What the page looks like right now, in the terms this test cares about.
 *
 * 🚨 THE STRUCTURAL FACTS ARE READ FROM COMPUTED STYLE, not from class names.
 *
 * The first fix moved the text out of message data and was accepted on that
 * basis; the screen still showed MigraPilot's avatar beside a bordered card.
 * Acceptance is about what the user perceives, so this asks the browser what
 * the pixels are: does the progress surface carry an image, does anything in
 * it have a border, a shadow, a card radius. Those are the properties that
 * make a reader see "MigraPilot said this".
 */
const SAMPLE = () => {
  const progress = [...document.querySelectorAll('[data-testid=turn-progress]')]
  const messages = [...document.querySelectorAll('[data-testid=assistant-message]')]

  const chrome = progress.flatMap((root) =>
    [root, ...root.querySelectorAll('*')].flatMap((el) => {
      const style = getComputedStyle(el)
      const found = []
      if (el.tagName === 'IMG') found.push('an avatar/image')
      if (parseFloat(style.borderTopWidth) > 0) found.push('a border')
      if (style.boxShadow && style.boxShadow !== 'none') found.push('a card shadow')
      // Dots are circles; a CARD radius is what matters, so only flag a radius
      // on something wide enough to be a container.
      if (parseFloat(style.borderTopLeftRadius) > 6 && el.getBoundingClientRect().width > 60) {
        found.push('a bubble radius')
      }
      return found
    }),
  )

  return {
    progressCount: progress.length,
    progressText: progress.map((el) => el.textContent?.trim() ?? '').join(' | '),
    progressChrome: [...new Set(chrome)],
    messageTexts: messages.map((el) => el.textContent?.trim() ?? ''),
  }
}

;(async () => {
  console.log('COLD-START VERIFICATION')
  console.log('─'.repeat(72))

  // 1. Identity BEFORE evidence. A mismatch is a hard stop, not a warning.
  const identity = await assertRigIdentity(RIG, TARGET.expectedBuildId ? { expectBuildId: TARGET.expectedBuildId } : {})
  console.log(`   rig ${RIG} (${TARGET.source}) → buildId ${identity.buildId}`)

  // 2. Make the cold start real.
  console.log('\n2. evicting resident models')
  await evictModels()

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addCookies([sessionCookie('tester', new URL(RIG).hostname)])
  const page = await context.newPage()

  const failures = []
  let sawColdStart = false
  let maxProgress = 0
  let coexisted = null
  let infrastructureShown = null
  let leakedIntoMessage = null
  let messageChrome = null

  try {
    // RULE 4 — the server's build is not the browser's build.
    const loadedAssets = []
    page.on('response', (res) => { const u = res.url(); if (u.includes('/_next/static/')) loadedAssets.push(u) })
    await page.goto(`${RIG}/`, { waitUntil: 'networkidle', timeout: 60_000 })
    const client = assertClientBuild(loadedAssets, path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.next', 'static'), fs.existsSync)
    console.log(`   client build: ${client.assets} assets, all from this build`)

    console.log('\n3. sending a turn as a signed-in user')
    const box = page.getByLabel('Message MigraPilot')
    await box.waitFor({ timeout: 20_000 })
    await box.fill('In one short sentence, what is a checklist for?')
    await page.getByLabel('Send message').click()

    console.log('\n4. watching the wait')
    const started = Date.now()
    let answered = ''
    while (Date.now() - started < 240_000) {
      const sample = await page.evaluate(SAMPLE)

      if (sample.progressText.includes(COLD_START)) {
        // Capture the moment itself, once. This is the frame the defect was
        // reported from, and the only honest way to show it is fixed.
        if (!sawColdStart) await page.screenshot({ path: `${SP}/cold-start-during.png` })
        sawColdStart = true
      }
      maxProgress = Math.max(maxProgress, sample.progressCount)

      // The SECOND acceptance failure was not the text — it was the chrome
      // around it. An avatar beside a bordered card is what "MigraPilot said
      // this" looks like, whatever component drew it.
      if (sample.progressChrome.length > 0 && !messageChrome) messageChrome = sample.progressChrome

      // The regression: the loading line inside a message bubble.
      const leak = sample.messageTexts.find((text) => FORBIDDEN.some((f) => text.includes(f)))
      if (leak && !leakedIntoMessage) leakedIntoMessage = leak

      /*
       * THE PRODUCTION DEFECT, ASSERTED WHEREVER IT WOULD SHOW.
       *
       * The previous version only asked whether infrastructure wording reached
       * a MESSAGE. It reached the progress surface instead, which this harness
       * watched the whole time and never questioned — the text was treated as
       * the expected signal rather than as something to object to.
       */
      const spoken = FORBIDDEN.find((f) => sample.progressText.includes(f))
      if (spoken && !infrastructureShown) infrastructureShown = spoken

      // The duplicate: progress still up while the answer is being written.
      const written = sample.messageTexts.filter((t) => t.length > 0)
      if (sample.progressCount > 0 && written.length > 0 && !coexisted) {
        coexisted = { progress: sample.progressText, message: written[written.length - 1] }
      }

      answered = written[written.length - 1] ?? ''
      if (answered.length > 60) break
      await sleep(120)
    }
    console.log(`   answer began: ${answered ? `“${answered.slice(0, 60)}…”` : 'NOTHING ARRIVED'}`)
    await page.screenshot({ path: `${SP}/cold-start-after.png` })

    // 5. Settle, then reload: history must not carry runtime state.
    await sleep(4000)
    await page.reload({ waitUntil: 'networkidle', timeout: 60_000 })
    await sleep(2000)
    const afterReload = await page.evaluate(() => document.body.innerText)

    /* ---------------- verdict ---------------- */
    console.log('\n5. verdict')

    if (!sawColdStart) {
      failures.push(
        'INCONCLUSIVE: the cold-start line was never observed, so nothing here was tested.\n' +
          '     The model was probably still warm. Re-run; do not read this as a pass.',
      )
    }
    if (infrastructureShown) {
      failures.push(
        `infrastructure wording was shown to the user: “${infrastructureShown}”.\n` +
          '     Status copy describes the user’s work, never the machinery doing it.',
      )
    }
    if (leakedIntoMessage) {
      failures.push(`the loading line rendered INSIDE an assistant message: “${leakedIntoMessage.slice(0, 90)}”`)
    }
    if (messageChrome) {
      failures.push(
        `the progress surface is dressed as a message — it has ${messageChrome.join(', ')}.\n` +
          '     A reader does not know which component rendered it; they know that chrome means MigraPilot spoke.',
      )
    }
    if (maxProgress > 1) {
      failures.push(`${maxProgress} progress surfaces were on screen at once — there must be exactly one`)
    }
    if (coexisted) {
      failures.push(
        'a progress surface was still showing while the answer was being written:\n' +
          `     progress: “${coexisted.progress.slice(0, 70)}”\n` +
          `     answer:   “${coexisted.message.slice(0, 70)}”`,
      )
    }
    if (!answered) {
      failures.push('no answer ever arrived, so the transient state was never replaced by one')
    }
    if (afterReload.includes(COLD_START) || FORBIDDEN.some((f) => afterReload.includes(f))) {
      failures.push('the loading line survived a reload — runtime state was persisted as conversation content')
    }

    console.log(`   cold start observed:        ${sawColdStart ? 'yes' : 'NO'}`)
    console.log(`   infrastructure wording:     ${infrastructureShown ? `YES — defect (“${infrastructureShown}”)` : 'none'}`)
    console.log(`   max progress surfaces:      ${maxProgress}`)
    console.log(`   message chrome on progress: ${messageChrome ? `YES — ${messageChrome.join(', ')}` : 'none'}`)
    console.log(`   loading text in a message:  ${leakedIntoMessage ? 'YES — defect' : 'no'}`)
    console.log(`   progress outlived the start:${coexisted ? ' YES — defect' : ' no'}`)
    console.log(`   present after reload:       ${afterReload.includes(COLD_START) || FORBIDDEN.some((f) => afterReload.includes(f)) ? 'YES — defect' : 'no'}`)
  } finally {
    await browser.close()
  }

  if (failures.length > 0) {
    console.error('\n✗ COLD-START VERIFICATION FAILED')
    for (const failure of failures) console.error(`   · ${failure}`)
    process.exit(1)
  }
  console.log('\n✓ COLD-START VERIFICATION PASSED')
})().catch((error) => fail(error.stack ?? String(error)))
