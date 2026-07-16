#!/usr/bin/env node
/**
 * MigraAI RAG repository benchmark.
 *
 * Indexes a real workspace root through the engine (/api/ai/indexes) and runs a
 * behavior-based eval set: locate a function by behavior, find where a concern is
 * enforced, refuse when no evidence exists. Measures recall@K, best rank of a
 * relevant chunk, retrieval latency, indexing time, index size. Records a JSON
 * result. Promotion (→ approved) stays a human decision after review.
 *
 * Usage: node scripts/benchmark-rag.mjs <absolute-root>
 *   ENGINE_URL overrides http://127.0.0.1:3988
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENGINE = process.env.ENGINE_URL ?? 'http://127.0.0.1:3988';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.argv[2];
if (!ROOT) { console.error('usage: node scripts/benchmark-rag.mjs <absolute-root>'); process.exit(1); }

const H = { 'content-type': 'application/json', 'x-owner-scope': 'local', 'x-workspace-scope': ROOT };
const post = (u, b) => fetch(ENGINE + u, { method: 'POST', headers: H, body: JSON.stringify(b) }).then((r) => r.json());

// Behavior-based eval: query + a substring the RELEVANT source file path must contain.
// `absent` = there is no such thing in the repo; retrieval should be weak/empty.
const CASES = [
  { id: 'locate-qualification', query: 'where are models marked approved or rejected for the router', expectPath: 'qualification' },
  { id: 'locate-router', query: 'how does the engine choose which model answers by capability and tier', expectPath: 'capabilityRouter' },
  { id: 'locate-memory-redaction', query: 'where are secrets and API keys stripped before storing conversation memory', expectPath: 'redaction' },
  { id: 'locate-approval', query: 'single-use approval token bound to a tool input, replay refused', expectPath: 'toolApprovalStore' },
  { id: 'locate-agent-state', query: 'agent run state machine with fail-closed transitions', expectPath: 'agentRunStore' },
  { id: 'locate-chunker', query: 'language aware chunking by function class and heading', expectPath: 'chunker' },
  { id: 'absent-payments', query: 'stripe subscription billing webhook signature verification for invoices', expectPath: null },
];

const K = 6;

async function main() {
  const created = await post('/api/ai/indexes', { root: ROOT, sourceType: 'workspace' });
  if (!created.id) { console.error('create failed', created); process.exit(1); }
  const t0 = Date.now();
  const synced = await post(`/api/ai/indexes/${created.id}/sync`, {});
  const indexMs = Date.now() - t0;
  if (!synced.ok) { console.error('sync failed', synced); process.exit(1); }
  const stats = synced.index.stats;

  const results = [];
  let recallHits = 0, absentCorrect = 0, absentTotal = 0, latencies = [];
  for (const c of CASES) {
    const t = Date.now();
    const r = await post('/api/ai/retrieve', { indexId: created.id, query: c.query, maxChunks: K });
    const ms = Date.now() - t;
    latencies.push(ms);
    const paths = (r.chunks ?? []).map((x) => x.filePath);
    if (c.expectPath === null) {
      absentTotal += 1;
      // "Absent" is correct when the top hit is weak (low score) OR clearly unrelated.
      const topScore = r.chunks?.[0]?.score ?? 0;
      const weak = topScore < 0.35;
      if (weak) absentCorrect += 1;
      results.push({ id: c.id, absent: true, topScore: topScore, weak, ms });
    } else {
      const rank = paths.findIndex((p) => p.toLowerCase().includes(c.expectPath.toLowerCase()));
      const hit = rank >= 0;
      if (hit) recallHits += 1;
      results.push({ id: c.id, expectPath: c.expectPath, rank: hit ? rank + 1 : null, hit, top: paths[0], ms });
    }
  }

  const locate = CASES.filter((c) => c.expectPath !== null).length;
  const summary = {
    root: ROOT,
    index: { files: stats.files, chunks: stats.chunks, approxKB: Math.round(stats.approxBytes / 1024), indexMs, embeddingModel: synced.index.embeddingModel },
    recallAtK: `${recallHits}/${locate}`,
    absentHandled: `${absentCorrect}/${absentTotal}`,
    retrievalLatencyMsAvg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    passesThreshold: recallHits >= Math.ceil(locate * 0.8) && absentCorrect === absentTotal,
    results,
  };
  mkdirSync(path.join(HERE, '../eval/results'), { recursive: true });
  writeFileSync(path.join(HERE, `../eval/results/rag-${process.env.BENCH_STAMP ?? 'latest'}.json`), JSON.stringify(summary, null, 2));

  console.log('\nindex:', summary.index.files, 'files,', summary.index.chunks, 'chunks,', summary.index.approxKB, 'KB, indexed in', indexMs, 'ms');
  console.log('recall@' + K + ':', summary.recallAtK, '| absent handled:', summary.absentHandled, '| avg retrieve', summary.retrievalLatencyMsAvg, 'ms');
  for (const r of results) {
    if (r.absent) console.log('  ', r.id.padEnd(24), 'absent → topScore', r.topScore.toFixed(3), r.weak ? '(correctly weak)' : '(TOO STRONG)');
    else console.log('  ', r.id.padEnd(24), r.hit ? `rank ${r.rank}` : 'MISS', '→', r.top);
  }
  console.log('\nthreshold: recall ≥80% AND all absent handled →', summary.passesThreshold ? 'PASS' : 'FAIL');
  // Clean up the eval index (do not leave an approved index behind).
  await fetch(`${ENGINE}/api/ai/indexes/${created.id}`, { method: 'DELETE', headers: { 'x-owner-scope': 'local', 'x-workspace-scope': ROOT } });
}

await main();
