#!/usr/bin/env node
/**
 * MigraAI reasoning-aware qualification benchmark.
 *
 * Reasoning models emit chain-of-thought; the plain generate benchmark
 * (scripts/benchmark-models.mjs — unchanged) unfairly scores their concise-answer
 * cases because CoT consumes the token budget. This evaluator uses Ollama CHAT
 * semantics and scores ONLY the final assistant answer:
 *
 *  - uses /api/chat
 *  - detects `thinking` support via /api/show
 *  - runs think:false (reasoning disabled) AND think:true (reasoning enabled)
 *  - scores message.content ONLY; message.thinking is read never, stored never
 *  - classifies the control as disabled | enabled | unsupported (empty output under
 *    an UNSUPPORTED control is not a failure — it's re-run without the control)
 *  - non-reasoning models are handled with the same prompts/criteria, no control
 *
 * The production promotion threshold is IDENTICAL to the non-reasoning benchmark
 * (see THRESHOLD). Reasoning models get a fair test, not a lower bar.
 *
 * Usage:  node scripts/benchmark-reasoning.mjs qwen3:14b deepseek-r1:14b
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OLLAMA = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const EVAL = JSON.parse(readFileSync(path.join(HERE, '../eval/migraai-eval-set.json'), 'utf8'));

/** Production qualification threshold — the SAME bar as the non-reasoning
 * benchmark (matches the approved floor, qwen2.5-coder:7b = 7/9). */
const THRESHOLD = 7;

async function capabilities(model) {
  try {
    const j = await (await fetch(`${OLLAMA}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) })).json();
    return new Set(j.capabilities ?? []);
  } catch {
    return new Set();
  }
}

/**
 * One chat turn. Returns ONLY the final answer text + control status. The
 * reasoning content (message.thinking) is deliberately never read or returned.
 */
async function chat(model, prompt, { think, num }) {
  const body = { model, messages: [{ role: 'user', content: prompt }], stream: false, options: { num_predict: num, temperature: 0 } };
  if (think !== undefined) body.think = think;
  const res = await fetch(`${OLLAMA}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Ollama rejects `think` on non-thinking models — classify as unsupported.
    if (/think|thinking/i.test(detail)) return { control: 'unsupported' };
    throw new Error(`HTTP ${res.status}`);
  }
  const j = await res.json();
  return {
    control: 'ok',
    content: (j.message?.content ?? '').trim(), // final answer only; thinking ignored
    tokPerSec: j.eval_count && j.eval_duration ? j.eval_count / (j.eval_duration / 1e9) : 0,
  };
}

function scoreCase(c, text) {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (c.json) {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) return false;
    try {
      const obj = JSON.parse(m[0]);
      if (c.json.requireKeys && !c.json.requireKeys.every((k) => k in obj)) return false;
      if (c.json.equals && !Object.entries(c.json.equals).every(([k, v]) => obj[k] === v)) return false;
      return true;
    } catch { return false; }
  }
  const okMatch = c.match ? t.includes(c.match) : true;
  const okAny = c.matchAny ? c.matchAny.some((s) => t.includes(s)) : true;
  return okMatch && okAny;
}

/** Run the full eval set for a model under one thinking control. */
async function runPass(model, think, num) {
  let passed = 0;
  let controlStatus = think === undefined ? 'n/a' : think ? 'enabled' : 'disabled';
  const cases = [];
  for (const c of EVAL.cases) {
    let r, ok = false, sample = '';
    try {
      r = await chat(model, c.prompt, { think, num });
      if (r.control === 'unsupported') {
        controlStatus = 'unsupported';
        // Re-run WITHOUT the control — an unsupported control is not a failure.
        r = await chat(model, c.prompt, { think: undefined, num });
      }
      ok = scoreCase(c, r.content);
      sample = (r.content ?? '').replace(/\s+/g, ' ').slice(0, 100); // final answer only
    } catch (e) {
      sample = `ERROR: ${e.message}`;
    }
    if (ok) passed += 1;
    cases.push({ id: c.id, category: c.category, pass: ok, sample });
    process.stderr.write(`   [${controlStatus}] ${ok ? 'PASS' : 'FAIL'} ${c.id}\n`);
  }
  return { control: controlStatus, passed, total: EVAL.cases.length, cases };
}

async function main() {
  const models = process.argv.slice(2);
  if (!models.length) { console.error('usage: node scripts/benchmark-reasoning.mjs <model> [model...]'); process.exit(1); }
  const results = [];
  for (const model of models) {
    const caps = await capabilities(model);
    const thinkingCapable = caps.has('thinking');
    process.stderr.write(`\n▶ ${model}  (thinking-capable: ${thinkingCapable})\n`);
    const rec = { model, thinkingCapable, threshold: THRESHOLD };
    if (thinkingCapable) {
      process.stderr.write(`  — reasoning DISABLED (final-answer-only)\n`);
      rec.disabled = await runPass(model, false, 400);
      process.stderr.write(`  — reasoning ENABLED (final-answer-only)\n`);
      rec.enabled = await runPass(model, true, 2048);
      // Fair production read = reasoning-disabled concise answers.
      rec.qualifyScore = rec.disabled.passed;
    } else {
      process.stderr.write(`  — non-reasoning (control n/a)\n`);
      rec.normal = await runPass(model, undefined, 400);
      rec.qualifyScore = rec.normal.passed;
    }
    rec.passesThreshold = rec.qualifyScore >= THRESHOLD;
    results.push(rec);
  }

  const outDir = path.join(HERE, '../eval/results');
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `reasoning-${process.env.BENCH_STAMP ?? 'latest'}.json`);
  writeFileSync(outFile, JSON.stringify({ ollama: OLLAMA, threshold: THRESHOLD, results }, null, 2));

  console.log('\nmodel'.padEnd(22), 'think?'.padStart(7), 'disabled'.padStart(9), 'enabled'.padStart(8), 'qualify'.padStart(8), `≥${THRESHOLD}?`.padStart(6));
  for (const r of results) {
    const dis = r.disabled ? `${r.disabled.passed}/${r.disabled.total}` : (r.normal ? `${r.normal.passed}/${r.normal.total}` : '-');
    const en = r.enabled ? `${r.enabled.passed}/${r.enabled.total}` : '-';
    console.log(r.model.padEnd(22), String(r.thinkingCapable).padStart(7), dis.padStart(9), en.padStart(8), `${r.qualifyScore}/${EVAL.cases.length}`.padStart(8), (r.passesThreshold ? 'PASS' : 'FAIL').padStart(6));
  }
  console.log(`\nthreshold ${THRESHOLD}/${EVAL.cases.length} (same as non-reasoning). wrote ${outFile}`);
}

await main();
