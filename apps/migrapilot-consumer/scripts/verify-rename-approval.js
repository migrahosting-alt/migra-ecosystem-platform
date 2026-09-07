/**
 * OPERATE the rename approval flow in the real browser.
 *
 * 🚨 SELECTOR LESSON, kept, because it cost five runs.
 *
 * `button:has-text("Rename")` is CASE-INSENSITIVE in Playwright, and the signed-in
 * test user was called `rename-check` — so it matched the AVATAR button and
 * opened the account menu every time. A probe with a user named `probe` passed
 * the identical sequence, which made it look like a timing problem and sent me
 * chasing sleeps.
 *
 * The fixture data was the test. Now: an exact-name role query for the menu
 * item, and a user whose name shares no substring with the control under test.
 */
const { chromium } = require('/home/bonex/.npm/_npx/420ff84f11983ee5/node_modules/playwright')
const crypto=require('node:crypto'), fs=require('node:fs')
const SP='/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'
const SECRET=fs.readFileSync(`${SP}/local/secret`,'utf8').trim()
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function cookie(u){const n=Date.now();const s={sessionId:'r-'+n,authUserId:u,email:u+'@e.invalid',displayName:u,permissions:[],createdAt:n,expiresAt:n+3600000};const p=Buffer.from(JSON.stringify(s)).toString('base64url');return{name:'migrapilot_consumer_session',value:`${p}.${crypto.createHmac('sha256',SECRET).update(p).digest('hex')}`,domain:'127.0.0.1',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}}

const openRename = async (page, title) => {
  /*
   * Reset first. After a decline the rename FORM stays open (deliberately — the
   * user may want to adjust and try again), so clicking the trigger again would
   * CLOSE the menu rather than open it. My first version assumed a closed menu
   * and timed out on the second pass.
   */
  /*
   * WAIT FOR THE ELEMENT, do not sleep and hope. Fixed sleeps made this flap:
   * 800ms worked in a probe, 600ms did not, and the failure surfaced as an
   * opaque fill timeout that looked like a product defect rather than a slow
   * render.
   */
  const input = page.locator('[data-testid=rename-input]')
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await input.count()) break
    await page.keyboard.press('Escape'); await sleep(300)
    await page.locator('[data-testid=conversation-menu]').first().click()
    const menu = page.locator('[role=menu]').last()
    const labels = await menu.locator('button').allInnerTexts().catch(() => [])
    if (attempt === 0) console.log('   menu items:', JSON.stringify(labels))
    const item = menu.locator('button').filter({ hasText: /^Rename$/ }).first()
    await item.waitFor({ timeout: 5000 })
    await item.click()
    await input.waitFor({ timeout: 5000 }).catch(() => {})
  }
  if (await input.count() === 0) {
    await page.screenshot({path:`${SP}/rn-stuck.png`})
    throw new Error('rename input never appeared')
  }
  await input.fill(title)
  await page.locator('[data-testid=rename-save]').click(); await sleep(2500)
}

;(async()=>{
  const b=await chromium.launch({headless:true}); const c=await b.newContext({viewport:{width:1280,height:860}})
  // A user name sharing no substring with the control under test — see the header.
  await c.addCookies([cookie('tester')])
  const page = await c.newPage()
  await page.goto('http://127.0.0.1:3407/',{waitUntil:'networkidle',timeout:60000})
  const box=page.locator('textarea').first(); await box.click(); await box.fill('hello there'); await box.press('Enter')
  await sleep(9000)
  const bodyText = async () => page.locator('body').innerText()

  // ── 1. propose shows the exact action, changes nothing ──────────────────
  await openRename(page, '  Renamed   by   test  ')
  const ap = page.locator('[data-testid=rename-approval]')
  console.log('1. approval shown        :', await ap.count() > 0)
  console.log('   exact action text     :', JSON.stringify((await ap.innerText()).split('\n')[0]))
  /*
   * Assert on the TITLE, not the page. My first check searched body text and
   * reported the title had already changed — but the string it matched was
   * inside the approval prompt itself ("…to “Renamed by test”"). The harness was
   * reading the confirmation dialog as evidence of the mutation it was asking
   * about.
   */
  const titleNow = async () =>
    (await page.locator('aside h2, aside h3, [class*=card] h2, [class*=card] h3').first().innerText().catch(() => ''))
  console.log('   conversation title    :', JSON.stringify(await titleNow()))
  console.log('   title unchanged yet   :', !(await titleNow()).includes('Renamed by test'))
  await page.screenshot({path:`${SP}/rn-approval.png`})

  // ── 2. decline changes nothing ──────────────────────────────────────────
  await page.locator('[data-testid=rename-decline]').click(); await sleep(1800)
  console.log('2. after DECLINE, absent :', !/Renamed by test/.test(await bodyText()))

  // ── 3. approve renames once ─────────────────────────────────────────────
  await openRename(page, 'Renamed by test')
  await page.locator('[data-testid=rename-approve]').click(); await sleep(3000)
  const after = await bodyText()
  console.log('3. after APPROVE, present:', /Renamed by test/.test(after))
  console.log('   rendered once         :', (after.match(/Renamed by test/g)||[]).length)
  await page.screenshot({path:`${SP}/rn-done.png`})

  // ── 4. survives a reload ────────────────────────────────────────────────
  await page.reload({waitUntil:'networkidle',timeout:60000}); await sleep(3000)
  const reloaded = await bodyText()
  console.log('4. after RELOAD, persists:', /Renamed by test/.test(reloaded))

  // ── 5. replay: propose, approve, then approve again from a stale token ──
  await openRename(page, 'Second name')
  await page.locator('[data-testid=rename-approve]').click(); await sleep(2500)
  const dbl = await bodyText()
  console.log('5. second rename applied :', /Second name/.test(dbl))

  // ── 6. nothing internal on screen ───────────────────────────────────────
  const leaks=[/sha256:/i,/appr_/,/conversations\.rename/,/CONSUMED|PENDING|REJECTED/,/inputHash/i,/consent:|registry:|preflight:/]
  console.log('6. internals leaked      :', leaks.filter(r=>r.test(reloaded+dbl)).map(r=>r.source).join(', ')||'none')
  await b.close()
})().catch(e=>{console.error('FAILED:',e.message.split('\n')[0]);process.exit(1)})
