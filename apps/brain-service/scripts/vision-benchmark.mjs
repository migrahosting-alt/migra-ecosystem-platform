#!/usr/bin/env node
/**
 * Measure the installed vision models. Repeatable, because a one-off script on a
 * host is not evidence anybody else can reproduce or disagree with.
 *
 * 🚨 RUN IT FROM A CHECKOUT, NOT FROM A RELEASE DIRECTORY. The first version of
 * this was written straight into `/opt/.../brain-service/current/`, which is a
 * RELEASE — immutable, and identified by a buildId over its contents. Adding a
 * file to it means the deployed tree no longer matches what was built and
 * verified. Releases are read-only; scratch work belongs outside them.
 *
 *   node scripts/vision-benchmark.mjs --provider http://host:11434 --dir /tmp/vision-bench
 *
 * The fixtures the --dir must hold, and why each is shaped that way:
 *
 *   page-1.png      a REAL PDF page rasterised at 150dpi (pdftoppm), scored
 *                   against that PDF's own text layer. The ground truth comes out
 *                   of the file: not written by the author of this script, and not
 *                   visible to the model.
 *   wide-NN-<n>.png disks at RANDOMISED positions, <n> of them. Randomised
 *                   because a grid can be counted by its rows rather than by
 *                   seeing each shape.
 *
 * Why not "render a cat, ask if there is a cat": the word is in the question, so a
 * model that always answers "yes, a cat" scores perfectly. A keyword search
 * standing in for a semantic claim measures nothing.
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { argv } from 'node:process';
import { extractPdf } from '../dist/src/engine/rag/pdfText.js';
import {
  scoreTranscription, parseCount, transcriptionPassed, countingPassed,
  TRANSCRIPTION_RECALL_BAR, TRANSCRIPTION_PRECISION_BAR, COUNTING_ACCURACY_BAR,
} from '../dist/src/engine/vision/visionBenchmark.js';

const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const BASE = arg('provider', 'http://127.0.0.1:11434').replace(/\/$/, '');
const DIR = arg('dir', '/tmp/vision-bench');
const ONLY = arg('models', '').split(',').filter(Boolean);

/** Every installed model that claims vision, with its digest for the evidence record. */
async function visionModels() {
  const tags = await (await fetch(`${BASE}/api/tags`)).json();
  const all = tags.models ?? [];
  const candidates = all.filter((m) => /vl|vision|llava|minicpm/i.test(m.name));
  return (ONLY.length ? candidates.filter((m) => ONLY.includes(m.name)) : candidates)
    .map((m) => ({ id: m.name, digest: m.digest ?? null }));
}

/**
 * One image question, in the SAME request shape the Brain's provider uses —
 * `image_url` with a data URI through /v1/chat/completions. A benchmark that
 * exercises a different path than production measures a different product.
 */
async function askImage(model, pngPath, prompt, maxTokens) {
  const b64 = (await readFile(pngPath)).toString('base64');
  const began = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(240_000),
    body: JSON.stringify({
      model, temperature: 0, max_tokens: maxTokens,
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ]}],
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const d = await res.json();
  return { answer: d.choices?.[0]?.message?.content ?? '', ms: Date.now() - began };
}

// Ground truth comes from the PDF the page was rasterised FROM, never from the raster.
const truth = (await extractPdf(new Uint8Array(await readFile(`${DIR}/sample-text.pdf`)))).text;
const countFiles = (await readdir(DIR)).filter((f) => f.startsWith('wide-')).sort();

const report = {
  measuredAt: new Date().toISOString(), provider: BASE,
  groundTruthChars: truth.length, countingImages: countFiles.length,
  bars: { TRANSCRIPTION_RECALL_BAR, TRANSCRIPTION_PRECISION_BAR, COUNTING_ACCURACY_BAR },
  models: {},
};

for (const { id, digest } of await visionModels()) {
  const entry = { digest, transcription: null, counting: [], errors: [] };
  try {
    const t = await askImage(id, `${DIR}/page-1.png`,
      'Transcribe every word of text in this image, exactly as written. Output only the text.', 700);
    entry.transcription = { ...scoreTranscription({ expected: truth, answer: t.answer }), ms: t.ms };
  } catch (e) { entry.errors.push(`transcription: ${e.message}`); }

  for (const f of countFiles) {
    const expected = Number(f.replace(/\.png$/, '').split('-').pop());
    try {
      const c = await askImage(id, `${DIR}/${f}`,
        'How many dark circles are in this image? Reply with just the number.', 40);
      entry.counting.push({ image: f, expected, got: parseCount(c.answer), raw: c.answer.trim().slice(0, 40) });
    } catch (e) { entry.errors.push(`${f}: ${e.message}`); }
  }

  entry.transcriptionPassed = entry.transcription ? transcriptionPassed([entry.transcription]) : false;
  entry.countingPassed = countingPassed(entry.counting);
  // Reported per range, because a flat percentage hides that a model can count
  // reliably up to some number and collapse past it — which is what was measured.
  const le = entry.counting.filter((c) => c.expected <= 10);
  const gt = entry.counting.filter((c) => c.expected > 10);
  const exact = (s) => s.filter((c) => c.got === c.expected).length;
  entry.countingByRange = { upTo10: `${exact(le)}/${le.length}`, above10: `${exact(gt)}/${gt.length}` };
  report.models[id] = entry;

  const tr = entry.transcription;
  console.log(`\n== ${id}  digest=${(digest ?? '?').slice(0, 12)}`);
  console.log(tr
    ? `   transcription recall=${tr.recall.toFixed(2)} precision=${tr.precision.toFixed(2)} -> ${entry.transcriptionPassed ? 'PASS' : 'FAIL'}`
    : '   transcription DID NOT RUN');
  console.log(`   counting ${exact(entry.counting)}/${entry.counting.length} -> ${entry.countingPassed ? 'PASS' : 'FAIL'}`
    + `   (<=10: ${entry.countingByRange.upTo10}, >10: ${entry.countingByRange.above10})`);
  if (entry.errors.length) console.log(`   errors: ${entry.errors[0]}`);
}

const out = `${DIR}/vision-evidence.json`;
await writeFile(out, JSON.stringify(report, null, 2));
console.log(`\nwrote ${out}`);
