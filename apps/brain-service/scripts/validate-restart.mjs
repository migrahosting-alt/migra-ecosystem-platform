#!/usr/bin/env node
/**
 * MigraAI Durable State — real process-restart validation.
 * Spawns the brain, creates a durable conversation + an approved workspace index,
 * KILLS the process, restarts it, and verifies durable state survived: conversation
 * resumes, retrieval works, unchanged content is not re-embedded, isolation holds.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BRAIN = path.join(HERE, '../dist/src/server.js');
const CWD = path.join(HERE, '..');
const PORT = 3994;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-restart-')), 'state.db');
const WS = path.join(HERE, '../src/engine/rag'); // small dir to index
const H = (ws = WS) => ({ 'content-type': 'application/json', 'x-owner-scope': 'local', 'x-workspace-scope': ws });
const post = (u, b, ws) => fetch(BASE + u, { method: 'POST', headers: H(ws), body: JSON.stringify(b) }).then((r) => r.json());
const get = (u, ws) => fetch(BASE + u, { headers: H(ws) }).then((r) => r.json());
const chat = async (prompt, id) => { const r = await fetch(BASE + '/api/ai/chat', { method: 'POST', headers: H(), body: JSON.stringify({ prompt, conversationId: id, stream: true, memoryPolicy: { mode: 'durable', store: true, retrieve: true } }) }); await r.text(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startBrain() {
  const p = spawn('node', [BRAIN], { cwd: CWD, env: { ...process.env, MIGRAPILOT_BRAIN_PORT: String(PORT), MIGRAPILOT_STATE_DB: DB }, stdio: 'ignore' });
  return p;
}
async function waitHealth() {
  for (let i = 0; i < 40; i++) { try { const h = await get('/health'); if (h.status) return h; } catch {} await sleep(500); }
  throw new Error('brain did not become healthy');
}
function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('  ok —', msg); }

async function main() {
  let brain = startBrain();
  let h = await waitHealth();
  console.log('1) started; readiness.persistence =', h.readiness?.persistence, '| schemaVersion', h.readiness?.schemaVersion);
  assert(h.readiness?.persistence === 'ready', 'persistence ready on first start');

  // Durable conversation + two turns.
  const conv = await post('/api/ai/conversations', { memoryMode: 'durable' });
  await chat('first durable turn', conv.id);
  await chat('second durable turn', conv.id);
  const before = (await get(`/api/ai/conversations/${conv.id}/messages`)).messages.length;
  console.log('2) durable conversation', conv.id, 'messages:', before);

  // Index + approve a workspace.
  const idx = await post('/api/ai/indexes', { root: WS });
  const t0 = Date.now();
  const synced = await post(`/api/ai/indexes/${idx.id}/sync`, {});
  const firstSyncMs = Date.now() - t0;
  await post(`/api/ai/indexes/${idx.id}`, { state: 'approved' }, WS); // PATCH via POST? no — use PATCH
  await fetch(`${BASE}/api/ai/indexes/${idx.id}`, { method: 'PATCH', headers: H(), body: JSON.stringify({ state: 'approved' }) });
  const chunks = synced.index.stats.chunks;
  console.log('3) indexed', synced.index.stats.files, 'files →', chunks, 'chunks in', firstSyncMs, 'ms; approved');

  // ── RESTART ──
  brain.kill('SIGTERM');
  await sleep(1500);
  console.log('4) killed brain');
  brain = startBrain();
  h = await waitHealth();
  console.log('5) restarted; readiness.persistence =', h.readiness?.persistence);
  assert(h.readiness?.persistence === 'ready', 'persistence ready after restart');

  // Resume conversation.
  const after = (await get(`/api/ai/conversations/${conv.id}/messages`)).messages.length;
  assert(after === before && after >= 4, `durable conversation resumed (${after} messages)`);

  // Approved index survived; retrieval works.
  const st = await get(`/api/ai/indexes/${idx.id}/status`);
  assert(st.state === 'approved' && st.stats.chunks === chunks, `approved index survived (${st.stats.chunks} chunks, state ${st.state})`);
  const r = await post('/api/ai/retrieve', { indexId: idx.id, query: 'language aware chunking by function and heading' });
  assert(r.ok && r.chunks.some((c) => /chunker/.test(c.filePath)), 'retrieval works after restart (found chunker)');

  // Re-sync unchanged files → should be fast (no re-embedding) + same chunk count.
  const t1 = Date.now();
  const resync = await post(`/api/ai/indexes/${idx.id}/sync`, {});
  const resyncMs = Date.now() - t1;
  assert(resync.index.stats.chunks === chunks, 'chunk count unchanged after restart re-sync');
  assert(resyncMs < firstSyncMs, `re-sync fast (${resyncMs}ms < first ${firstSyncMs}ms) → no re-embedding of unchanged content`);

  // Isolation: a different workspace sees neither the conversation nor the index.
  const iso = await get(`/api/ai/conversations/${conv.id}`, '/ws/OTHER');
  assert(iso.code === 'UNKNOWN_CONVERSATION', 'cross-workspace conversation read denied after restart');
  const isoIdx = await get(`/api/ai/indexes/${idx.id}/status`, '/ws/OTHER');
  assert(isoIdx.code === 'UNKNOWN_INDEX', 'cross-workspace index read denied after restart');

  brain.kill('SIGTERM');
  await sleep(500);
  fs.rmSync(path.dirname(DB), { recursive: true, force: true });
  console.log(process.exitCode ? '\nRESTART VALIDATION: FAILED' : '\nRESTART VALIDATION: PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
