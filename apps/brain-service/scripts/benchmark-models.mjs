#!/usr/bin/env node
/**
 * MigraAI model qualification benchmark.
 *
 * Measures each model against MigraAI tasks (not marketing claims): cold + warm
 * load, first-token latency, tokens/sec, GPU offload %, and a small internal eval
 * set (TS/Node, JSON adherence, reasoning, patch intent, Creole/FR/ES,
 * hallucination resistance, refusal to fabricate). Records a JSON result; the
 * catalog + qualification manifest are updated by a human after review.
 *
 * Usage:  node scripts/benchmark-models.mjs qwen3:14b deepseek-r1:14b ...
 *         OLLAMA_URL overrides the endpoint (default http://localhost:11434).
 *
 * Fail-closed: this ONLY reads models + generates; it never pulls, deletes, or
 * changes the router. Approval remains a human decision.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = JSON.parse(readFileSync(path.join(HERE, '../eval/migraai-eval-set.json'), 'utf8'));

async function gen(model, prompt, opts = {}) {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: opts.num ?? 256, temperature: 0 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  return {
    text: j.response ?? '',
    wallMs: Date.now() - started,
    loadMs: (j.load_duration ?? 0) / 1e6,
    firstTokenMs: (j.prompt_eval_duration ?? 0) / 1e6,
    tokPerSec: j.eval_count && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : 0,
    outTokens: j.eval_count ?? 0,
  };
}

async function vramPct(model) {
  try {
    const j = await (await fetch(`${OLLAMA}/api/ps`)).json();
    const m = (j.models ?? []).find((x) => x.name === model || x.model === model);
    return m && m.size ? Math.round((100 * m.size_vram) / m.size) : null;
  } catch {
    return null;
  }
}

function scoreCase(c, text) {
  const t = text.trim();
  if (c.json) {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return false;
    try {
      const obj = JSON.parse(m[0]);
      if (c.json.requireKeys && !c.json.requireKeys.every((k) => k in obj)) return false;
      if (c.json.equals && !Object.entries(c.json.equals).every(([k, v]) => obj[k] === v)) return false;
      return true;
    } catch {
      return false;
    }
  }
  const okMatch = c.match ? t.includes(c.match) : true;
  const okAny = c.matchAny ? c.matchAny.some((s) => t.includes(s)) : true;
  return okMatch && okAny;
}

async function benchmarkModel(model) {
  process.stderr.write(`\n▶ ${model}\n`);
  // Cold: unload then load (best-effort — Ollama keeps models alive; the first
  // gen after idle approximates cold). Warm: immediate second gen.
  const cold = await gen(model, 'Reply with only: READY', { num: 8 });
  const warm = await gen(model, 'Reply with only: READY', { num: 8 });
  const vram = await vramPct(model);

  const cases = [];
  let passed = 0;
  for (const c of EVAL.cases) {
    let text = '';
    let ok = false;
    try {
      const r = await gen(model, c.prompt, { num: 200 });
      text = r.text;
      ok = scoreCase(c, text);
    } catch (e) {
      text = `ERROR: ${e.message}`;
    }
    if (ok) passed += 1;
    cases.push({ id: c.id, category: c.category, pass: ok, sample: text.replace(/\s+/g, ' ').slice(0, 120) });
    process.stderr.write(`   ${ok ? 'PASS' : 'FAIL'} ${c.id}\n`);
  }

  return {
    model,
    coldLoadMs: Math.round(cold.loadMs),
    warmLoadMs: Math.round(warm.loadMs),
    firstTokenMs: Math.round(warm.firstTokenMs),
    tokPerSec: Number(warm.tokPerSec.toFixed(1)),
    gpuOffloadPct: vram,
    evalPassed: passed,
    evalTotal: EVAL.cases.length,
    cases,
  };
}

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    console.error('usage: node scripts/benchmark-models.mjs <model> [model...]');
    process.exit(1);
  }
  const results = [];
  for (const m of models) {
    try {
      results.push(await benchmarkModel(m));
    } catch (e) {
      results.push({ model: m, error: e.message });
    }
  }
  const outDir = path.join(HERE, '../eval/results');
  mkdirSync(outDir, { recursive: true });
  const stamp = process.env.BENCH_STAMP ?? 'latest';
  const outFile = path.join(outDir, `benchmark-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify({ ollama: OLLAMA, results }, null, 2));

  // Human-readable table to stdout.
  console.log('\nmodel'.padEnd(26), 'tok/s'.padStart(7), 'ftl_ms'.padStart(8), 'gpu%'.padStart(6), 'eval'.padStart(6));
  for (const r of results) {
    if (r.error) { console.log(r.model.padEnd(26), 'ERROR', r.error); continue; }
    console.log(r.model.padEnd(26), String(r.tokPerSec).padStart(7), String(r.firstTokenMs).padStart(8), String(r.gpuOffloadPct ?? '?').padStart(6), `${r.evalPassed}/${r.evalTotal}`.padStart(6));
  }
  console.log(`\nwrote ${outFile}`);
}

await main();
