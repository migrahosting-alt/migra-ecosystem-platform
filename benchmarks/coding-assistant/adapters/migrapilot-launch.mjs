// Launch one real VS Code per task, with the PACKAGED VSIX and a real Brain
// backed by a real coding model, then record what MigraPilot did.
//   node adapters/migrapilot-launch.mjs [taskId ...]
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { prepare, runVisibleSuite, runHidden, scope, TASKS } from '../run.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BENCH = path.dirname(HERE);
const REPO = path.resolve(BENCH, '../..');
const EXT = path.join(REPO, 'apps/vscode-extension');
const RESULTS = path.join(BENCH, 'results');
const VSCODE = path.join(EXT, '.vscode-test/vscode-linux-x64-1.114.0/code');
/**
 * A FREE PORT PER TASK, never a fixed one.
 *
 * This harness used to pin :3996 and kill the brain between tasks. When one
 * survived, the next brain logged "port already in use; reusing the existing
 * healthy local service" and EXITED — so the launcher's kill hit a dead pid, and
 * every later task silently talked to a brain whose allowed workspace root was
 * the PREVIOUS task's. The visible symptom was "workspaceRoot is outside the
 * allowed workspace boundary" and three tasks scoring zero, which reads exactly
 * like a product regression and is not one.
 */
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}
const MODEL = process.env.BENCH_MODEL ?? 'qwen3-coder:30b';

for (const k of Object.keys(process.env)) if (k.startsWith('VSCODE_')) delete process.env[k];
delete process.env.ELECTRON_RUN_AS_NODE;

function unzipVsix() {
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-vsix-'));
  const r = spawnSync('unzip', ['-q', '-o', path.join(EXT, 'migrapilot-extension-0.1.0.vsix'), '-d', staging]);
  if (r.status !== 0) throw new Error('unzip failed');
  return path.join(staging, 'extension');
}

async function waitForBrain(brainUrl, child) {
  for (let i = 0; i < 240; i += 1) {
    // A brain that exited can never become healthy; failing fast beats a 2-minute
    // wait followed by a confusing result.
    if (child.exitCode !== null) throw new Error(`brain exited with code ${child.exitCode} before becoming healthy`);
    try { if ((await fetch(`${brainUrl}/health`)).ok) return; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('brain never came up');
}

const wanted = process.argv.slice(2);
const tasks = wanted.length ? TASKS.filter((t) => wanted.includes(t.id)) : TASKS;
const packaged = unzipVsix();
fs.mkdirSync(RESULTS, { recursive: true });

for (const task of tasks) {
  const root = prepare(task);
  const before = runVisibleSuite(root);
  const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-db-'));
  const BRAIN_PORT = await freePort();
  const BRAIN_URL = `http://127.0.0.1:${BRAIN_PORT}`;
  const out = path.join(RESULTS, `migrapilot__${task.id}.evidence.json`);
  fs.rmSync(out, { force: true });

  // A REAL brain, with the governed coding capability bounded to THIS root only.
  const brain = spawn('node', [path.join(REPO, 'apps/brain-service/dist/src/server.js')], {
    env: {
      ...process.env,
      MIGRAPILOT_BRAIN_PORT: String(BRAIN_PORT),
      MIGRAPILOT_STATE_DB: path.join(dbDir, 'engine.db'),
      MIGRAPILOT_CODING_ENABLED: '1',
      MIGRAPILOT_CODING_WORKSPACE_ROOTS: root,
      MIGRAPILOT_CODING_MODEL: MODEL,
      MIGRAPILOT_CODING_VALIDATION_COMMAND: 'npm test',
      // A REAL model, not the stub. `MIGRAPILOT_LOCAL_PROVIDER` defaults to
      // 'stub'; anything else selects the openai-compatible protocol, which is
      // what Ollama serves. The first run measured the stub and was worthless.
      // The literal value matters: `env.localProvider === 'openai-compat'` is the
      // gate in aiRoutes, engineerRoutes and the provider registry. 'ollama' is
      // not 'stub', but it is not the gate either — it still served the stub.
      MIGRAPILOT_LOCAL_PROVIDER: 'openai-compat',
      MIGRAPILOT_PROVIDER_URL: process.env.MIGRAPILOT_PROVIDER_URL ?? 'http://127.0.0.1:11434/v1',
      OLLAMA_API_BASE: process.env.OLLAMA_API_BASE ?? 'http://127.0.0.1:11434',
      MIGRAPILOT_LOCAL_MODEL: MODEL,
      MIGRAPILOT_DEFAULT_MODEL: MODEL,
      MIGRAPILOT_CHEAP_MODEL: MODEL,
    },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  });
  const brainLog = path.join(RESULTS, `migrapilot__${task.id}.brain.log`);
  fs.writeFileSync(brainLog, '');
  brain.stdout?.on('data', (d) => fs.appendFileSync(brainLog, String(d)));
  brain.stderr?.on('data', (d) => fs.appendFileSync(brainLog, String(d)));
  await waitForBrain(BRAIN_URL, brain);

  // PROVENANCE. A benchmark launcher must OWN the service it measures, and the
  // record must prove it did. This harness once pinned a fixed port; when a brain
  // survived a task, the next one exited with "port already in use" and every
  // later task silently talked to a brain whose allowed workspace root was the
  // PREVIOUS task's — producing zero-file failures that read as product
  // regressions. Nothing in the result said which brain answered.
  //
  // These fields travel WITH the result so a future run cannot quietly become
  // incomparable to this one.
  const health = await (await fetch(`${BRAIN_URL}/health`)).json();
  const provenance = {
    brainPid: brain.pid,
    brainPort: BRAIN_PORT,
    brainUrl: BRAIN_URL,
    workspaceRoot: root,
    codingRootsGranted: root,
    service: health?.service ?? null,
    serviceVersion: health?.version ?? null,
    /** Seconds of uptime when we first saw it. A brain we started is near zero. */
    uptimeSecAtAttach: health?.uptimeSec ?? null,
    // The model REQUESTED, not necessarily the one used: the Brain's router picks
    // by tier and has been observed selecting `qwen2.5-coder:14b` when
    // `qwen3-coder:30b` was configured. A provenance field that records an
    // intention as if it were a fact is exactly what makes runs quietly
    // incomparable, so it is named for what it is.
    modelRequested: MODEL,
    /** Populated per task from the run's own evidence when the engine reports it. */
    modelRouted: null,
    spawnedByHarness: true,
    timeoutOverrides: [],
  };
  if (provenance.service !== 'migrapilot-brain') {
    throw new Error(`unexpected service on the benchmark port: ${provenance.service}`);
  }
  // A brain WE started cannot already have been up for a while. This is the check
  // that would have caught the reuse bug on its first occurrence.
  if (typeof provenance.uptimeSecAtAttach === 'number' && provenance.uptimeSecAtAttach > 60) {
    throw new Error(
      `attached to a brain with ${provenance.uptimeSecAtAttach}s uptime — this harness did not start it, so the result would be incomparable`,
    );
  }

  // Seed the instance's USER settings before launch, outside the repository, so
  // the task tree stays byte-identical to what every other tool receives.
  const userDir = path.join(dbDir, 'vscode-user');
  fs.mkdirSync(path.join(userDir, 'User'), { recursive: true });
  fs.writeFileSync(path.join(userDir, 'User', 'settings.json'), JSON.stringify({
    'migrapilot.brainUrl': BRAIN_URL,
    // NO TIMEOUT OVERRIDES. Slice 2 made the shipped defaults workable for local
    // inference, so the benchmark now measures what a user actually gets. If a
    // task fails on a deadline from here on, that is a real result.
    'migrapilot.autoStartBrain': false,
    'migrapilot.autoApplyChangeset': true,
    'migrapilot.developerMode': false,
  }, null, 2));

  const started = Date.now();
  const { runTests } = await import('@vscode/test-electron');
  try {
    await runTests({
      vscodeExecutablePath: VSCODE,
      extensionDevelopmentPath: packaged,
      extensionTestsPath: path.join(HERE, 'migrapilot-suite.cjs'),
      launchArgs: [root, '--disable-extensions', '--no-sandbox', '--disable-gpu',
        '--disable-workspace-trust', `--user-data-dir=${path.join(dbDir, 'vscode-user')}`],
      extensionTestsEnv: {
        BENCH_OUT: out, BENCH_TASK: JSON.stringify(task), BENCH_BRAIN_URL: BRAIN_URL,
        BENCH_EXT_ROOT: packaged,
        BENCH_SRC_DIST: path.join(EXT, 'dist'), BENCH_STARTED: new Date(started).toISOString(),
        DISPLAY: process.env.DISPLAY ?? ':99', MIGRAPILOT_STATE_DB: 'off',
      },
    });
  } catch (error) {
    fs.writeFileSync(out.replace('.evidence.json', '.launch-error.txt'), String(error));
  }
  const wallMs = Date.now() - started;
  try { process.kill(-brain.pid, 'SIGKILL'); } catch { /* gone */ }

  const after = runVisibleSuite(root);
  const hidden = runHidden(root, task.verify);
  const touched = scope(root);
  const evidence = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { errors: ['no evidence written'] };

  const record = {
    tool: 'migrapilot', label: 'MigraPilot', task: task.id, kind: task.kind,
    model: MODEL, wallMs,
    provenance: { ...provenance, modelRouted: evidence.modelRouted ?? null },
    visibleBefore: { exit: before.exitCode, pass: before.passed, fail: before.failed },
    visibleAfter: { exit: after.exitCode, pass: after.passed, fail: after.failed },
    hidden: hidden.applicable ? { pass: hidden.passed, fail: hidden.failed, exit: hidden.exitCode } : null,
    scope: touched,
    ranTestsItself: (evidence.capabilities ?? []).includes('test.run'),
    capabilities: evidence.capabilities ?? [],
    steps: evidence.steps ?? [],
    testOutcome: evidence.testOutcome ?? null,
    errors: evidence.errors ?? [],
    root,
  };
  fs.writeFileSync(path.join(RESULTS, `migrapilot__${task.id}.json`), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(RESULTS, `migrapilot__${task.id}.transcript.txt`), evidence.answer ?? '');
  // A RERUN MUST NOT DESTROY THE ANSWER IT IS BEING COMPARED AGAINST. The English
  // t1 answer from one rerun was overwritten by the next and is gone; the
  // comparison that depended on it had to be corrected from memory. Every run also
  // keeps its own copy, keyed by the Brain PID that produced it.
  const archive = path.join(RESULTS, 'runs', `${task.id}`);
  fs.mkdirSync(archive, { recursive: true });
  fs.writeFileSync(path.join(archive, `${provenance.brainPid}.transcript.txt`), evidence.answer ?? '');
  fs.writeFileSync(path.join(archive, `${provenance.brainPid}.json`), JSON.stringify(record, null, 2));
  console.log(
    `migrapilot   ${task.id.padEnd(12)} ${String(Math.round(wallMs / 1000)).padStart(4)}s`,
    `visible ${record.visibleAfter.pass}/${record.visibleAfter.pass + record.visibleAfter.fail}`,
    record.hidden ? `hidden ${record.hidden.pass}/${record.hidden.pass + record.hidden.fail}` : 'hidden n/a',
    `files ${touched.files.length}`,
    `caps [${record.capabilities.join(' ')}]`,
    record.errors.length ? `ERRORS ${record.errors.length}` : '',
  );
}
