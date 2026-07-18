#!/usr/bin/env node
/**
 * Operational Data Foundation — Slice 1: real process-restart acceptance.
 * Spawns the brain, drives REAL operational evidence (correlated tool audit
 * events + a configured budget scope), KILLS the process, restarts it, and
 * verifies the durable operational evidence survived and health is truthful.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAIN = path.join(HERE, '../dist/src/server.js');
const CWD = path.join(HERE, '..');
const PORT = 3995;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-oprestart-')), 'state.db');

const H = (extra = {}) => ({ 'content-type': 'application/json', 'x-owner-scope': 'local', 'x-workspace-scope': '/ws/acc', ...extra });
const get = (u, extra) => fetch(BASE + u, { headers: H(extra) }).then((r) => r.json());
const post = (u, b, extra) => fetch(BASE + u, { method: 'POST', headers: H(extra), body: JSON.stringify(b) }).then((r) => r.json().catch(() => ({})));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBrain() {
  return spawn('node', [BRAIN], {
    cwd: CWD,
    env: { ...process.env, MIGRAPILOT_BRAIN_PORT: String(PORT), MIGRAPILOT_STATE_DB: DB, MIGRAPILOT_BUDGET_ENABLED: 'true', MIGRAPILOT_BUDGET_MONTHLY_USD: '50', MIGRAPILOT_BUDGET_PER_REQUEST_USD: '5' },
    stdio: 'ignore',
  });
}
async function waitHealth() {
  for (let i = 0; i < 40; i++) { try { const h = await get('/health'); if (h.status) return h; } catch {} await sleep(500); }
  throw new Error('brain did not become healthy');
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok —', msg); }

async function main() {
  let brain = startBrain();
  let h = await waitHealth();
  console.log('1) started; operational =', JSON.stringify(h.operational));
  assert(h.operational?.schemaVersion === 2, 'operational schema v2 on first start');
  assert(h.operational?.reachable === true, 'durable operational store reachable');
  assert(h.operational?.integrity === 'ok', 'integrity ok on first start');
  assert(h.operational?.retentionWorker === 'running', 'retention worker running');
  assert(h.operational?.status === 'healthy', 'operational health healthy');

  // Budget scope configured from env → persisted at startup.
  const b0 = await get('/api/ai/providers/budget');
  const monthly0 = (b0.scopes ?? []).find((s) => s.kind === 'monthly');
  assert(!!monthly0 && monthly0.hardLimitUsd === 50, 'monthly budget scope present ($50)');

  // Drive REAL correlated audit evidence: pick a read-only tool and call it with an
  // explicit correlation id (uncorrelated calls are intentionally not audited).
  const cat = await get('/api/ai/tools?readOnly=true');
  const tool = (cat.tools ?? [])[0];
  assert(!!tool?.id, `read-only tool available to drive audit (${tool?.id})`);
  for (let i = 0; i < 3; i++) await post('/api/ai/tools', { tool: tool.id, input: {} }, { 'x-correlation-id': `acc-${i}` });

  h = await get('/health');
  const auditBefore = h.operational?.counts?.auditEvents ?? 0;
  console.log('2) drove tool audit; durable auditEvents =', auditBefore);
  assert(auditBefore >= 3, 'at least 3 durable audit events recorded');

  // ── RESTART ──
  brain.kill('SIGTERM');
  await sleep(1500);
  console.log('3) killed brain (clean shutdown)');
  brain = startBrain();
  h = await waitHealth();
  console.log('4) restarted; operational =', JSON.stringify(h.operational));
  assert(h.operational?.schemaVersion === 2, 'schema v2 after restart');
  assert(h.operational?.status === 'healthy', 'operational healthy after restart');
  const auditAfter = h.operational?.counts?.auditEvents ?? 0;
  assert(auditAfter >= auditBefore, `durable audit evidence survived restart (${auditAfter} >= ${auditBefore})`);

  // Budget scope survived + reconciled onto the still-defined env scope.
  const b1 = await get('/api/ai/providers/budget');
  const monthly1 = (b1.scopes ?? []).find((s) => s.kind === 'monthly');
  assert(!!monthly1 && monthly1.hardLimitUsd === 50, 'monthly budget scope survived restart ($50)');

  brain.kill('SIGTERM');
  await sleep(500);
  fs.rmSync(path.dirname(DB), { recursive: true, force: true });
  console.log(process.exitCode ? '\nOPERATIONAL RESTART VALIDATION: FAILED' : '\nOPERATIONAL RESTART VALIDATION: PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
