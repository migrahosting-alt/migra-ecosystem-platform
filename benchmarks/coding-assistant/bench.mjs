// Run one tool across every task and record the evidence.
//   node bench.mjs <tool>       tool ∈ claude-code | codex | copilot
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, runVisibleSuite, runHidden, scope, TASKS, git } from './run.mjs';
import { ADAPTERS } from './adapters/cli.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS = path.join(HERE, 'results');
const TIMEOUT_MS = 15 * 60 * 1000;

/** Environment failures that make a run meaningless, with the reason. */
function detectInvalid(transcript) {
  const checks = [
    [/requires a newer version of Codex|unknown variant `max`/i, 'Codex CLI is older than the account\'s model; the API refused with HTTP 400'],
    [/Access denied by policy settings|Copilot CLI policy/i, 'GitHub Copilot CLI is blocked by an organisation policy'],
    [/not logged in|authentication required|please run .*login/i, 'the CLI is not authenticated'],
    [/Not inside a trusted directory/i, 'the CLI refused the working directory'],
  ];
  for (const [re, reason] of checks) if (re.test(transcript)) return reason;
  return null;
}

const tool = process.argv[2];
const adapter = ADAPTERS[tool];
if (!adapter) throw new Error(`unknown tool: ${tool}`);
fs.mkdirSync(RESULTS, { recursive: true });

for (const task of TASKS) {
  const root = prepare(task);
  const before = runVisibleSuite(root);
  const started = Date.now();
  const res = adapter.run(root, task.prompt, TIMEOUT_MS);
  const wallMs = Date.now() - started;

  const after = runVisibleSuite(root);
  const hidden = runHidden(root, task.verify);
  const touched = scope(root);
  const transcript = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim();

  const record = {
    tool, label: adapter.label, task: task.id, kind: task.kind,
    wallMs, exitCode: res.status, timedOut: res.error?.code === 'ETIMEDOUT',
    visibleBefore: { exit: before.exitCode, pass: before.passed, fail: before.failed },
    visibleAfter: { exit: after.exitCode, pass: after.passed, fail: after.failed },
    hidden: hidden.applicable ? { pass: hidden.passed, fail: hidden.failed, exit: hidden.exitCode } : null,
    scope: touched,
    // Did the tool run the tests ITSELF? Evidence, not inference.
    ranTestsItself: /npm (run )?test|node --test/.test(transcript),
    // A tool that could not START must never be scored as if it had tried and
    // failed. Codex reported a CLI/server version mismatch and Copilot an
    // organisation policy denial; both exited cleanly having done nothing, and
    // their untouched baselines would otherwise have read as real measurements.
    invalid: detectInvalid(transcript),
    transcriptChars: transcript.length,
    root,
  };
  fs.writeFileSync(path.join(RESULTS, `${tool}__${task.id}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(RESULTS, `${tool}__${task.id}.transcript.txt`), transcript);
  console.log(
    `${tool.padEnd(12)} ${task.id.padEnd(12)} ${String(Math.round(wallMs / 1000)).padStart(4)}s`,
    `visible ${record.visibleAfter.pass}/${record.visibleAfter.pass + record.visibleAfter.fail}`,
    record.hidden ? `hidden ${record.hidden.pass}/${record.hidden.pass + record.hidden.fail}` : 'hidden n/a',
    `files ${touched.files.length}`,
    touched.touchedTests ? 'TOUCHED-TESTS' : '',
  );
}
