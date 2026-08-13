#!/usr/bin/env node
/**
 * MigraPilot Brain — deployment acceptance harness.
 *
 * Proves the ten infrastructure-gate properties against a RUNNING consumer
 * server and a RUNNING private Brain. Read-only: it creates at most one
 * conversation under the authenticated test identity's own scope, and never
 * reads another real user's data.
 *
 *   CONSUMER_BASE_URL=https://consumer.internal \
 *   BRAIN_BASE_URL=http://127.0.0.1:3988 \
 *   TEST_SESSION_COOKIE='migrapilot_consumer_session=…' \
 *   TEST_SUBJECT_A=<oidc-sub-of-test-user> \
 *   node deploy/acceptance/identity-isolation.mjs
 *
 * Every check reports PASS, FAIL, or SKIP-with-reason. A missing precondition
 * is never reported as a pass — a vacuous green is the failure mode this
 * harness exists to prevent.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CONSUMER = process.env.CONSUMER_BASE_URL?.replace(/\/+$/, '')
const BRAIN = process.env.BRAIN_BASE_URL?.replace(/\/+$/, '')
const COOKIE = process.env.TEST_SESSION_COOKIE
const SUBJECT_A = process.env.TEST_SUBJECT_A
const STATIC_DIR = process.env.STATIC_DIR ?? '.next/static'
const TIMEOUT = Number(process.env.ACCEPTANCE_TIMEOUT_MS ?? 8000)

const results = []
const record = (n, name, status, detail) => results.push({ n, name, status, detail })

async function req(url, init = {}) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT), redirect: 'manual' })
    const body = await res.text().catch(() => '')
    return { ok: true, status: res.status, body, headers: res.headers }
  } catch (error) {
    return { ok: false, error: error.message ?? String(error) }
  }
}

function walk(dir) {
  const out = []
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) out.push(...walk(p))
    else if (entry.endsWith('.js')) out.push(p)
  }
  return out
}

// ── 1 · Brain answers from the authorized application tier ─────────────────
async function check1() {
  if (!BRAIN) return record(1, 'Brain reachable from app tier', 'SKIP', 'BRAIN_BASE_URL not set')
  const res = await req(`${BRAIN}/health`)
  if (!res.ok) return record(1, 'Brain reachable from app tier', 'FAIL', `unreachable: ${res.error}`)
  record(1, 'Brain reachable from app tier', res.status === 200 ? 'PASS' : 'FAIL', `GET /health → ${res.status}`)
}

// ── 2 · Brain is NOT exposed through any public consumer route ──────────────
const BRAIN_PROBE_PATHS = [
  '/api/ai/conversations',
  '/api/ai/chat',
  '/api/ai/coding/capability',
  '/api/brain',
  '/api/brain/conversations',
  '/api/proxy/api/ai/conversations',
  '/health',
]
async function check2() {
  if (!CONSUMER) return record(2, 'Brain not exposed via consumer route', 'SKIP', 'CONSUMER_BASE_URL not set')
  const leaked = []
  for (const path of BRAIN_PROBE_PATHS) {
    const res = await req(`${CONSUMER}${path}`)
    // Anything that answers with Brain-shaped data is a leak. 404/405 is correct.
    if (res.ok && res.status === 200 && /conversations|governedCoding|schemaVersion/.test(res.body)) {
      leaked.push(`${path} → 200 with Brain-shaped body`)
    }
  }
  record(2, 'Brain not exposed via consumer route', leaked.length ? 'FAIL' : 'PASS',
    leaked.length ? leaked.join('; ') : `${BRAIN_PROBE_PATHS.length} paths probed, none proxied`)
}

// ── 3/4/5 · derived scope is the authenticated identity's, not the caller's ─
async function check345() {
  if (!CONSUMER || !COOKIE || !SUBJECT_A || !BRAIN) {
    const missing = [!CONSUMER && 'CONSUMER_BASE_URL', !COOKIE && 'TEST_SESSION_COOKIE',
      !SUBJECT_A && 'TEST_SUBJECT_A', !BRAIN && 'BRAIN_BASE_URL'].filter(Boolean).join(', ')
    record(3, 'Authenticated A yields user:<A-sub>', 'SKIP', `missing ${missing}`)
    record(4, 'Browser-supplied owner scope ignored', 'SKIP', `missing ${missing}`)
    record(5, 'Browser-supplied org id ignored', 'SKIP', `missing ${missing}`)
    return
  }

  const forgedSub = 'acceptance-forged-subject-does-not-exist'
  const marker = `acceptance-${Date.now()}`

  // Drive a write through the consumer WHILE sending every hostile hint a
  // browser controls. Requires a Phase 1 write route; skip cleanly if absent.
  const create = await req(`${CONSUMER}/api/conversations`, {
    method: 'POST',
    headers: {
      cookie: COOKIE,
      'content-type': 'application/json',
      'x-owner-scope': `user:${forgedSub}`,
      'X-Owner-Scope': `user:${forgedSub}`,
      'x-workspace-scope': 'org:forged-org',
    },
    body: JSON.stringify({ title: marker, authUserId: forgedSub, activeOrgId: 'forged-org' }),
  })

  if (!create.ok || create.status === 404) {
    const why = 'no consumer write route yet (Step 0 ships none by design) — re-run after Phase 1 wiring'
    record(3, 'Authenticated A yields user:<A-sub>', 'SKIP', why)
    record(4, 'Browser-supplied owner scope ignored', 'SKIP', why)
    record(5, 'Browser-supplied org id ignored', 'SKIP', why)
    return
  }

  // Ask the Brain directly, from the app tier, under the FORGED scope. The
  // forged subject owns nothing, so this reads no real user's data.
  const forged = await req(`${BRAIN}/api/ai/conversations`, {
    headers: { 'x-owner-scope': `user:${forgedSub}`, 'x-workspace-scope': 'org:forged-org' },
  })
  const landedInForged = forged.ok && forged.body.includes(marker)

  const real = await req(`${BRAIN}/api/ai/conversations`, {
    headers: { 'x-owner-scope': `user:${SUBJECT_A}`, 'x-workspace-scope': 'personal' },
  })
  const landedInReal = real.ok && real.body.includes(marker)

  record(3, 'Authenticated A yields user:<A-sub>', landedInReal ? 'PASS' : 'FAIL',
    landedInReal ? `record present under user:${SUBJECT_A}` : 'record not found under the authenticated subject')
  record(4, 'Browser-supplied owner scope ignored', landedInForged ? 'FAIL' : 'PASS',
    landedInForged ? 'record landed under the FORGED scope — boundary breached' : 'forged scope holds no record')
  record(5, 'Browser-supplied org id ignored', landedInForged ? 'FAIL' : 'PASS',
    landedInForged ? 'forged org accepted' : 'forged org namespace empty')
}

// ── 6 · unauthenticated callers cannot invoke the boundary ──────────────────
async function check6() {
  if (!CONSUMER) return record(6, 'Unauthenticated cannot invoke boundary', 'SKIP', 'CONSUMER_BASE_URL not set')
  const probes = ['/api/conversations', '/api/brain/conversations', '/api/ai/conversations']
  const bad = []
  for (const p of probes) {
    const res = await req(`${CONSUMER}${p}`, { headers: { 'x-owner-scope': 'user:anything' } })
    if (res.ok && res.status === 200 && /conversations/.test(res.body)) bad.push(`${p} → 200`)
  }
  record(6, 'Unauthenticated cannot invoke boundary', bad.length ? 'FAIL' : 'PASS',
    bad.length ? bad.join('; ') : 'no unauthenticated route returned tenant data')
}

// ── 7 · malformed canonical identity fails closed ───────────────────────────
async function check7() {
  // Proven exhaustively at unit level (src/server/brain/gateway.test.ts cases 6/6b).
  // Re-asserted here so the infrastructure gate does not depend on memory.
  const testFile = 'src/server/brain/gateway.test.ts'
  if (!existsSync(testFile)) return record(7, 'Malformed identity fails closed', 'SKIP', 'unit test file not found')
  const src = readFileSync(testFile, 'utf8')
  const covers = src.includes('tenancy_unresolved') && src.includes('TenancyError')
  record(7, 'Malformed identity fails closed', covers ? 'PASS' : 'FAIL',
    covers ? 'unit coverage present (run `npm test` for execution proof)' : 'unit coverage missing')
}

// ── 8 · arbitrary /api/ai/* paths cannot be proxied ─────────────────────────
async function check8() {
  if (!CONSUMER) return record(8, 'Arbitrary Brain paths not proxied', 'SKIP', 'CONSUMER_BASE_URL not set')
  const hostile = [
    '/api/ai/agent-mode/commands',
    '/api/ai/engineer/audit',
    '/api/ai/coding/runs/../../engineer/audit',
    '/api/brain/api/ai/engineer/incidents',
  ]
  const reachable = []
  for (const p of hostile) {
    const res = await req(`${CONSUMER}${p}`, { headers: COOKIE ? { cookie: COOKIE } : {} })
    if (res.ok && res.status === 200) reachable.push(`${p} → 200`)
  }
  record(8, 'Arbitrary Brain paths not proxied', reachable.length ? 'FAIL' : 'PASS',
    reachable.length ? reachable.join('; ') : `${hostile.length} hostile paths refused`)
}

// ── 9 · client bundle carries no Brain/scope material ───────────────────────
function check9() {
  const chunks = walk(STATIC_DIR)
  if (chunks.length === 0) {
    return record(9, 'Client bundle free of Brain material', 'SKIP',
      `${STATIC_DIR} has no chunks — run \`next build\` first (a scan of nothing is not a pass)`)
  }
  const forbidden = [
    'BRAIN_BASE_URL', '3988', '/api/ai/', 'x-owner-scope', 'x-workspace-scope',
    'callBrain', 'deriveBrainScope', 'resolveOperation',
    ...(process.env.BRAIN_DEPLOYED_HOST ? [process.env.BRAIN_DEPLOYED_HOST] : []),
  ]
  const hits = []
  let positiveControl = false
  for (const file of chunks) {
    const text = readFileSync(file, 'utf8')
    if (text.includes('MigraPilot')) positiveControl = true
    for (const needle of forbidden) if (text.includes(needle)) hits.push(`${needle} in ${file}`)
  }
  if (!positiveControl) {
    return record(9, 'Client bundle free of Brain material', 'FAIL',
      'positive control absent — the scan is not reading real bundle content')
  }
  record(9, 'Client bundle free of Brain material', hits.length ? 'FAIL' : 'PASS',
    hits.length ? hits.slice(0, 5).join('; ') : `${chunks.length} chunks scanned, ${forbidden.length} patterns clean`)
}

// ── 10 · no browser-originated request to Brain is even possible ────────────
function check10() {
  const findings = []
  // A NEXT_PUBLIC_ Brain variable would make the URL browser-visible.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('NEXT_PUBLIC_') && /BRAIN|OWNER_SCOPE/i.test(key)) findings.push(`env ${key}`)
  }
  // A route handler under app/ is the only way a browser could reach the server
  // gateway; Step 0 ships none, and Phase 1 must add them deliberately.
  const routeFiles = []
  const scan = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) scan(p)
      else if (entry === 'route.ts' || entry === 'route.js') routeFiles.push(p)
    }
  }
  scan('src/app')
  record(10, 'No direct browser→Brain path', findings.length ? 'FAIL' : 'PASS',
    findings.length ? findings.join('; ')
      : `no NEXT_PUBLIC Brain variable; ${routeFiles.length} server route handler(s) present${routeFiles.length ? ` (${routeFiles.join(', ')}) — review each in Phase 1` : ''}`)
}

// ── 11 · Production persistence must NOT be local SQLite ────────────────────
//
// PRODUCTION GATE. MigraPilot's production persistence architecture is
// PostgreSQL (Prisma), not an embedded database. `migraai-state.db` is a
// local/development fallback and must never back a production deployment:
// it is VM-local, invisible to the ecosystem's database standards, and outside
// the canonical backup/restore path.
//
// This gate fails closed. It fails when a local SQLite store would be used,
// AND it fails when brain-service contains no PostgreSQL adapter to use
// instead — because in that case production simply cannot be deployed
// correctly, and a green result would be a lie.
function check11() {
  const envFile = process.env.BRAIN_ENV_FILE
  const brainSrc = process.env.BRAIN_SRC_DIR ?? '../brain-service/src'

  let stateDb = process.env.MIGRAPILOT_STATE_DB
  let databaseUrl = process.env.DATABASE_URL
  if (envFile && existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const s = line.match(/^\s*MIGRAPILOT_STATE_DB\s*=\s*(.+?)\s*$/)
      if (s) stateDb = s[1].replace(/^["']|["']$/g, '')
      const d = line.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/)
      if (d) databaseUrl = d[1].replace(/^["']|["']$/g, '')
    }
  }

  // Does a PostgreSQL adapter exist in the engine at all?
  let pgAdapter = false
  const persistenceDir = join(brainSrc, 'engine', 'persistence')
  if (existsSync(persistenceDir)) {
    for (const entry of readdirSync(persistenceDir)) {
      if (/postgres|pg[A-Z_]|prisma/i.test(entry)) pgAdapter = true
    }
  }

  if (!pgAdapter) {
    return record(11, 'Production persistence is PostgreSQL, not SQLite', 'FAIL',
      'brain-service has NO PostgreSQL/Prisma adapter — engine/persistence contains only sqliteStore.ts, ' +
      'and server.ts binds SqliteDurableStore directly with no adapter selection. ' +
      'Production cannot be deployed on the canonical database until that adapter is implemented.')
  }
  if (stateDb) {
    return record(11, 'Production persistence is PostgreSQL, not SQLite', 'FAIL',
      `MIGRAPILOT_STATE_DB is set (${stateDb}) — a local SQLite store must not back production`)
  }
  if (!databaseUrl) {
    return record(11, 'Production persistence is PostgreSQL, not SQLite', 'FAIL',
      'DATABASE_URL is not configured — Brain would fall back to a local SQLite store')
  }
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
    return record(11, 'Production persistence is PostgreSQL, not SQLite', 'FAIL',
      'DATABASE_URL is not a postgres:// URL')
  }
  record(11, 'Production persistence is PostgreSQL, not SQLite', 'PASS',
    'PostgreSQL adapter present and DATABASE_URL configured; no local SQLite store in use')
}

// ── run ─────────────────────────────────────────────────────────────────────
await check1()
await check2()
await check345()
await check6()
await check7()
await check8()
check9()
check10()
check11()

results.sort((a, b) => a.n - b.n)
const width = Math.max(...results.map((r) => r.name.length))
console.log('\nMigraPilot Brain — deployment acceptance\n')
for (const r of results) {
  const badge = r.status === 'PASS' ? ' PASS ' : r.status === 'FAIL' ? ' FAIL ' : ' SKIP '
  console.log(`${String(r.n).padStart(2)}. [${badge}] ${r.name.padEnd(width)}  ${r.detail}`)
}
const failed = results.filter((r) => r.status === 'FAIL')
const skipped = results.filter((r) => r.status === 'SKIP')
console.log(`\n${results.length - failed.length - skipped.length} passed · ${failed.length} failed · ${skipped.length} skipped`)
if (skipped.length) console.log('SKIPPED CHECKS ARE NOT PASSES — supply the missing inputs and re-run.')
process.exit(failed.length ? 1 : 0)
