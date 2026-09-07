/**
 * The three states a click cannot produce, verified in the real browser.
 *
 * Engine proofs already cover the mechanics. What is checked here is the WORDING
 * a person actually reads — and, for the unknown outcome, that no Retry button
 * is offered anywhere near it.
 */
const { chromium } = require('/home/bonex/.npm/_npx/420ff84f11983ee5/node_modules/playwright')
const crypto=require('node:crypto'), fs=require('node:fs')
const SP='/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/d929835d-8849-4c9d-92e6-3d1922fab393/scratchpad'
const SECRET=fs.readFileSync(`${SP}/local/secret`,'utf8').trim()
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function cookie(u){const n=Date.now();const s={sessionId:'f-'+n,authUserId:u,email:u+'@e.invalid',displayName:u,permissions:[],createdAt:n,expiresAt:n+3600000};const p=Buffer.from(JSON.stringify(s)).toString('base64url');return{name:'migrapilot_consumer_session',value:`${p}.${crypto.createHmac('sha256',SECRET).update(p).digest('hex')}`,domain:'127.0.0.1',path:'/',httpOnly:true,secure:false,sameSite:'Lax'}}

;(async()=>{
  const b=await chromium.launch({headless:true}); const c=await b.newContext({viewport:{width:1280,height:860}})
  await c.addCookies([cookie('tester')]); const page=await c.newPage()
  page.on('response', async r => {
    if (r.url().includes('rename-approval')) {
      const body = await r.text().catch(()=> '')
      console.log(`   [${r.status()}] ${r.url().split('/api')[1]} -> ${body.slice(0,220)}`)
    }
  })
  await page.goto('http://127.0.0.1:3407/',{waitUntil:'networkidle',timeout:60000})
  const box=page.locator('textarea').first(); await box.click(); await box.fill('fault case'); await box.press('Enter')

  /*
   * WAIT FOR THE CONVERSATION, do not sleep for it. A fixed 9s was enough on a
   * warm Brain and not on a cold one — each fault run starts a fresh store, so
   * the first turn pays a model load. The failure surfaced as a click timeout on
   * a control that had simply not been created yet, which reads like a product
   * defect and is not one.
   */
  await page.locator('[data-testid=conversation-menu]').first().waitFor({ timeout: 90000 })
  await sleep(1500)

  const step = async (label, fn) => {
    try { await fn() } catch (e) { throw new Error(`${label}: ${e.message.split('\n')[0]}`) }
  }
  await step('open conversation menu', async () => {
    await page.locator('[data-testid=conversation-menu]').first().click(); await sleep(800)
  })
  const menu = page.locator('[role=menu]').last()
  await step('click Rename', async () => {
    const item = menu.locator('button').filter({ hasText: /^Rename$/ }).first()
    await item.waitFor({ timeout: 8000 }); await item.click()
  })
  await step('fill title', async () => {
    const input = page.locator('[data-testid=rename-input]')
    await input.waitFor({ timeout: 8000 }); await input.fill('Faulted name')
  })
  await step('click Save (propose)', async () => {
    await page.locator('[data-testid=rename-save]').click(); await sleep(3000)
  })
  console.log('approval shown :', await page.locator('[data-testid=rename-approval]').count() > 0)
  await step('click Rename (approve)', async () => {
    const btn = page.locator('[data-testid=rename-approve]')
    await btn.waitFor({ timeout: 8000 }); await btn.click(); await sleep(3500)
  })

  const blocked = page.locator('[data-testid=rename-blocked]')
  const unknown = page.locator('[data-testid=rename-unknown]')
  const which = await unknown.count() ? 'unknown' : await blocked.count() ? 'blocked' : 'none'
  const text = which === 'unknown' ? await unknown.innerText() : which === 'blocked' ? await blocked.innerText() : ''
  console.log('state shown    :', which)
  console.log('message        :', JSON.stringify(text.replace(/\n+/g,' ').trim()))

  // No Retry offered anywhere in the approval area.
  const form = page.locator('form').filter({ has: page.locator('[data-testid=rename-input]') }).first()
  const buttons = await form.locator('button').allInnerTexts().catch(()=>[])
  console.log('buttons offered:', JSON.stringify(buttons))
  console.log('offers retry   :', buttons.some(t=>/try again|retry/i.test(t)))

  const body = await page.locator('body').innerText()
  console.log('title changed  :', /Faulted name/.test(body.replace(text,'')))
  const leaks=[/sha256:/i,/appr_/,/CONSUMED|PENDING|REJECTED/,/injected/i,/ETIMEDOUT/]
  console.log('internals      :', leaks.filter(r=>r.test(body)).map(r=>r.source).join(', ')||'none')
  await page.screenshot({path:`${SP}/fault-${process.env.MIGRAPILOT_TEST_FAULT_RENAME||'none'}.png`})
  await b.close()
})().catch(e=>{console.error('FAILED:',e.message.split('\n')[0]);process.exit(1)})
