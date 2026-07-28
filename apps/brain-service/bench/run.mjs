/**
 * Local-model routing benchmark: latency matrix + quality runs.
 *
 * Both models see byte-identical prompts, system prompt, temperature, token limit and
 * seed. The only variable is the model id.
 *
 * Latency and quality are measured separately on purpose: latency needs a short fixed
 * prompt repeated under four load conditions, while quality needs one warm single run per
 * task. Mixing them would let a cold load or a queue contaminate a quality score.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { TASKS, GEN, SYSTEM_PROMPT } from './tasks.mjs';

const OLLAMA = 'http://127.0.0.1:11434';
const MODELS = ['qwen2.5-coder:14b', 'qwen2.5-coder:7b'];
const OUT = new URL('./results/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Unload a model so the next request pays a genuine cold load. */
async function unload(model) {
  await fetch(`${OLLAMA}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => {});
  await sleep(2500);
}

/** Residency right now, from the provider's own accounting. */
async function residency(model) {
  const r = await fetch(`${OLLAMA}/api/ps`).then((x) => x.json()).catch(() => ({}));
  const m = (r.models ?? []).find((x) => x.name === model);
  if (!m) return { loaded: false };
  return {
    loaded: true,
    totalGB: +(m.size / 1e9).toFixed(2),
    vramGB: +(m.size_vram / 1e9).toFixed(2),
    gpuPct: m.size ? Math.round((m.size_vram / m.size) * 100) : 0,
  };
}

/**
 * One streamed completion. Streaming is used for measurement because it is the only way
 * to see first-token latency separately from total — on `stream:false` this provider
 * withholds headers until generation completes.
 */
async function complete(model, prompt, { system = SYSTEM_PROMPT } = {}) {
  // performance.now(), NOT Date.now(): the first run produced a cold TTFT of 17701ms
  // against a total of 17199ms — arithmetically impossible for two reads of the same
  // clock, and the signature of a backwards NTP step. WSL2 corrects its clock during
  // long runs, so elapsed time here must come from a MONOTONIC source.
  const t0 = performance.now();
  let ttft;
  let text = '';
  let tokens = 0;

  const res = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      stream: true,
      ...GEN,
    }),
  });
  const headersAt = Math.round(performance.now() - t0);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) {
        if (ttft === undefined) ttft = Math.round(performance.now() - t0);
        text += delta;
        tokens += 1;
      }
    }
  }
  const totalMs = Math.round(performance.now() - t0);
  return { text, headersMs: headersAt, ttftMs: ttft ?? totalMs, totalMs, chunks: tokens,
           tokPerSec: tokens && totalMs ? +(tokens / (totalMs / 1000)).toFixed(1) : 0 };
}

// ── Latency matrix ───────────────────────────────────────────────────────────
const LAT_PROMPT = 'List three reasons to prefer a typed API client. One line each.';

async function latencyMatrix() {
  const rows = [];
  for (const model of MODELS) {
    // COLD — unloaded first, so the load cost is inside the measurement.
    await unload(model);
    const cold = await complete(model, LAT_PROMPT);
    const resCold = await residency(model);

    // WARM — immediately again, model resident.
    const warm = await complete(model, LAT_PROMPT);

    // QUEUED — two concurrent; report both so contention is visible, not averaged away.
    const [q1, q2] = await Promise.all([complete(model, LAT_PROMPT), complete(model, LAT_PROMPT)]);

    rows.push({
      model,
      residency: resCold,
      cold: { ttftMs: cold.ttftMs, totalMs: cold.totalMs, tokPerSec: cold.tokPerSec },
      warm: { ttftMs: warm.ttftMs, totalMs: warm.totalMs, tokPerSec: warm.tokPerSec },
      queued: [
        { ttftMs: q1.ttftMs, totalMs: q1.totalMs, tokPerSec: q1.tokPerSec },
        { ttftMs: q2.ttftMs, totalMs: q2.totalMs, tokPerSec: q2.tokPerSec },
      ],
    });
    console.log(`  ${model}`);
    console.log(`    residency: ${resCold.loaded ? `${resCold.vramGB}/${resCold.totalGB} GB = ${resCold.gpuPct}% GPU` : 'not loaded'}`);
    console.log(`    cold   ttft=${cold.ttftMs}ms total=${cold.totalMs}ms ${cold.tokPerSec} tok/s`);
    console.log(`    warm   ttft=${warm.ttftMs}ms total=${warm.totalMs}ms ${warm.tokPerSec} tok/s`);
    console.log(`    queued ttft=${q1.ttftMs}/${q2.ttftMs}ms total=${q1.totalMs}/${q2.totalMs}ms`);
  }
  writeFileSync(`${OUT}latency.json`, JSON.stringify(rows, null, 2));
  return rows;
}

// ── Quality runs ─────────────────────────────────────────────────────────────
async function qualityRuns() {
  const out = {};
  for (const model of MODELS) {
    out[model] = {};
    // Warm the model once so no quality run pays a cold load.
    await complete(model, 'ok').catch(() => {});
    for (const task of TASKS) {
      process.stdout.write(`  ${model} / ${task.id} … `);
      try {
        const r = await complete(model, task.prompt);
        out[model][task.id] = { text: r.text, ttftMs: r.ttftMs, totalMs: r.totalMs, tokPerSec: r.tokPerSec };
        console.log(`${r.totalMs}ms, ${r.text.length} chars`);
        writeFileSync(`${OUT}${task.id}.${model.replace(/[:.]/g, '_')}.md`, r.text);
      } catch (err) {
        out[model][task.id] = { error: String(err) };
        console.log(`FAILED ${err}`);
      }
    }
  }
  writeFileSync(`${OUT}quality.json`, JSON.stringify(out, null, 2));
  return out;
}

const mode = process.argv[2] ?? 'all';
if (mode === 'latency' || mode === 'all') {
  console.log('══ LATENCY MATRIX ══');
  await latencyMatrix();
}
if (mode === 'quality' || mode === 'all') {
  console.log('══ QUALITY RUNS ══');
  await qualityRuns();
}
console.log(`\nresults → ${OUT}`);
