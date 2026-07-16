#!/usr/bin/env node
/**
 * MigraAI vision-qualification benchmark.
 *
 * Establishes the Vision Registry the same way the engine/reasoning/RAG registries
 * were established: a vision model becomes a default only after it is licensed,
 * measured, and PROVEN against known ground truth.
 *
 *  - detects `vision` capability via /api/show (a non-vision model is skipped);
 *  - sends each deterministic fixture (image + prompt) via Ollama /api/chat with
 *    `images: [base64]`, temperature 0;
 *  - scores the answer with the SAME scorer the engine ships (dist visionScoring):
 *    synonym-group criteria + an OCR exact-text HARD gate;
 *  - fail-closed: an HTTP 500 / load error marks the model load-failed (never
 *    qualified — the posture that retired llama3.2-vision);
 *  - applies the SAME production bar (VISION_THRESHOLD); nothing lowers it.
 *
 * message.thinking (if any) is never read. Results → eval/results/vision-*.json.
 *
 * Usage:  node scripts/benchmark-vision.mjs qwen2.5vl:7b minicpm-v:8b llava:latest
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreFixture, ocrExactPass, qualifyVision, VISION_THRESHOLD } from '../dist/src/engine/vision/visionScoring.js';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = JSON.parse(readFileSync(path.join(HERE, '../eval/migraai-vision-eval-set.json'), 'utf8'));
const FIXDIR = path.join(HERE, '../eval');

async function capabilities(model) {
  try {
    const j = await (
      await fetch(`${OLLAMA}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) })
    ).json();
    return new Set(j.capabilities ?? []);
  } catch {
    return new Set();
  }
}

/** One multimodal chat turn. Returns the answer text + tok/s, or a load failure. */
async function askImage(model, prompt, imageB64) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt, images: [imageB64] }],
    stream: false,
    options: { temperature: 0, num_predict: 512 },
  };
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { loadFailed: true, detail: detail.slice(0, 160) };
  }
  const j = await res.json();
  return {
    content: (j.message?.content ?? '').trim(),
    tokPerSec: j.eval_count && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : 0,
  };
}

async function runModel(model) {
  const caps = await capabilities(model);
  const visionCapable = caps.has('vision');
  process.stderr.write(`\n▶ ${model}  (vision-capable: ${visionCapable})\n`);
  const rec = { model, visionCapable, threshold: VISION_THRESHOLD, fixtures: [] };
  if (!visionCapable) {
    rec.qualify = { overall: 0, passes: false, reason: 'no `vision` capability reported by /api/show' };
    return rec;
  }
  let loadFailed = false;
  let ocrExactPassed = true;
  const scores = [];
  let tps = 0;
  let tpsN = 0;
  for (const fx of EVAL.fixtures) {
    const imageB64 = readFileSync(path.join(FIXDIR, fx.image)).toString('base64');
    const r = await askImage(model, fx.prompt, imageB64);
    if (r.loadFailed) {
      loadFailed = true;
      rec.fixtures.push({ id: fx.id, dimension: fx.dimension, loadFailed: true, detail: r.detail });
      process.stderr.write(`   LOAD-FAIL ${fx.id}: ${r.detail}\n`);
      continue;
    }
    const { score, groups } = scoreFixture(r.content, fx.criteria);
    const ocrOk = fx.exactText ? ocrExactPass(r.content, fx.exactText) : true;
    if (fx.exactText && !ocrOk) ocrExactPassed = false;
    scores.push(score);
    if (r.tokPerSec) { tps += r.tokPerSec; tpsN += 1; }
    rec.fixtures.push({
      id: fx.id,
      dimension: fx.dimension,
      score: Number(score.toFixed(2)),
      groups,
      ocrExact: fx.exactText ? ocrOk : undefined,
      sample: r.content.replace(/\s+/g, ' ').slice(0, 160),
    });
    process.stderr.write(`   ${(score * 100).toFixed(0).padStart(3)}%  ${fx.exactText ? (ocrOk ? '[ocr✓] ' : '[ocr✗] ') : ''}${fx.id} (${fx.dimension})\n`);
  }
  rec.avgTokPerSec = tpsN ? Number((tps / tpsN).toFixed(1)) : 0;
  rec.qualify = qualifyVision({ fixtureScores: scores, loadFailed, ocrExactPassed });
  return rec;
}

async function main() {
  const models = process.argv.slice(2);
  if (!models.length) {
    console.error('usage: node scripts/benchmark-vision.mjs <model> [model...]');
    process.exit(1);
  }
  const results = [];
  for (const model of models) results.push(await runModel(model));

  const outDir = path.join(HERE, '../eval/results');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `vision-${process.env.BENCH_STAMP ?? 'latest'}.json`);
  writeFileSync(outFile, JSON.stringify({ ollama: OLLAMA, threshold: VISION_THRESHOLD, dimensions: EVAL.dimensions, results }, null, 2));

  console.log('\nmodel'.padEnd(20), 'vision'.padStart(7), 'overall'.padStart(8), 'tok/s'.padStart(7), `≥${VISION_THRESHOLD}?`.padStart(7), '  verdict');
  for (const r of results) {
    console.log(
      r.model.padEnd(20),
      String(r.visionCapable).padStart(7),
      `${(r.qualify.overall * 100).toFixed(0)}%`.padStart(8),
      String(r.avgTokPerSec ?? 0).padStart(7),
      (r.qualify.passes ? 'PASS' : 'FAIL').padStart(7),
      `  ${r.qualify.reason}`,
    );
  }
  console.log(`\nbar ${VISION_THRESHOLD} (same discipline as the other registries). wrote ${outFile}`);
}

await main();
