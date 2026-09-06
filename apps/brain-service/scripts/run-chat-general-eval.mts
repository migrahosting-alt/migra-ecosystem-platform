/*
 * Run the `chat.general` qualification suite against a candidate.
 *
 * WHY THIS FILE HAD TO EXIST. The suite was fully built — 30 cases, per-dimension
 * floors, a threshold committed before any candidate ran — and nothing called it.
 * `runChatGeneralSuite` had no entry point, so no candidate had ever been
 * measured, and Migra Core's "no approved model for chat.general" was not
 * waiting on an approval: it was waiting on evidence that did not exist.
 *
 * THIS SCRIPT PRODUCES EVIDENCE. IT APPROVES NOTHING. Recording and approving are
 * separate, governed steps that require an operator's MigraAuth token and a
 * signing key — deliberately not reachable from here. What comes out is a file
 * to be reviewed and then recorded by a person, or discarded.
 *
 *   usage: npx tsx scripts/run-chat-general-eval.mts \
 *            --model qwen3:8b [--base http://127.0.0.1:11434/v1] [--out <file>]
 */
import { writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { hostname } from 'node:os';

import { runChatGeneralSuite } from '../src/eval/chatGeneral/run.js';

const flag = (name: string, fallback?: string): string => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${name} is required`);
};

const model = flag('model');
const base = flag('base', 'http://127.0.0.1:11434/v1');
const out = flag('out', `chat-general-${model.replace(/[^\w.-]/g, '_')}-${Date.now()}.json`);

/*
 * The digest is read from the runtime, never passed in. A digest supplied by the
 * caller describes what the caller believes; this describes what actually
 * answered, and the two differ exactly when it matters most.
 */
async function digestOf(name: string): Promise<string> {
  const root = base.replace(/\/v1\/?$/, '');
  const res = await fetch(`${root}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`could not read model digest: HTTP ${res.status}`);
  const body = (await res.json()) as { digest?: string; details?: { parent_model?: string } };
  if (body.digest) return body.digest.startsWith('sha256:') ? body.digest : `sha256:${body.digest}`;
  const tags = (await (await fetch(`${root}/api/tags`)).json()) as {
    models?: Array<{ name: string; digest?: string }>;
  };
  const hit = tags.models?.find((m) => m.name === name);
  if (!hit?.digest) throw new Error(`no digest recorded for ${name}`);
  return hit.digest.startsWith('sha256:') ? hit.digest : `sha256:${hit.digest}`;
}

const gpu = await (async () => {
  try {
    const { execFileSync } = await import('node:child_process');
    return execFileSync('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'], {
      encoding: 'utf8',
    }).trim().split('\n')[0] ?? 'unknown GPU';
  } catch {
    return 'unknown GPU';
  }
})();

const digest = await digestOf(model);
console.error(`candidate : ${model}`);
console.error(`digest    : ${digest}`);
console.error(`hardware  : ${hostname()} / ${gpu}`);
console.error(`endpoint  : ${base}`);
console.error('running the suite — 30 cases x 3 replications, plus negative controls…\n');

const started = Date.now();
const evidence = await runChatGeneralSuite({
  baseUrl: base,
  model,
  hardware: `${hostname()} / ${gpu}`,
  runtime: 'ollama',
  modelDigest: digest,
});

writeFileSync(out, JSON.stringify(evidence, null, 2));

const v = evidence.verdict;
console.error(`\nfinished in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
console.error(`VERDICT: ${JSON.stringify(v, null, 2).slice(0, 900)}`);
console.error(`\nfailures: ${evidence.failures.length}`);
for (const f of evidence.failures.slice(0, 12)) {
  console.error(`  ${f.id} [${f.dimension}] ${f.runs.passed}/${f.runs.total}`);
}
console.error(`\nevidence written: ${out}`);
console.error('This is EVIDENCE ONLY. Recording and approving it are separate, operator-signed steps.');
