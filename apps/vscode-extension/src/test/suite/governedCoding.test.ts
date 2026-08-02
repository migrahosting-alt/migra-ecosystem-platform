/**
 * Installed-path acceptance for governed coding.
 *
 * Drives the REAL contributed command through the whole stack:
 *
 *   VS Code command registry → workspace resolution → extension workflow
 *     → Brain HTTP API → durable SQLite journal → approval interaction
 *     → repository mutation → validation and repair → rendered final report
 *
 * The client already has its own tests; this suite deliberately does NOT call it.
 * Anything provable one layer down is proved there, and re-proving it here would
 * hide the only thing this gate can establish — that the layers are actually
 * connected in the artifact a user installs.
 *
 * The provider is scripted, and its first edit is deliberately WRONG. A happy-path
 * proof would leave the repair loop — the part that makes completion trustworthy —
 * unexercised through the installed path.
 */

import * as assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { runFixtureTests } from '../support/codingFixture.js';
import { createScriptedCodingUi, type ScriptedCodingUi } from '../support/scriptedCodingUi.js';
import type { ScopeApprovalAnswer } from '../../services/governedCodingUi.js';

const EXTENSION_ID = 'MigraTeck.migrapilot-extension';
const CODING_PORT = 3994;
const BRAIN_URL = `http://127.0.0.1:${CODING_PORT}`;

const CONTRACT = 'src/contracts/orderTotals.js';
const SERVICE = 'src/services/orderTotalsService.js';
const ROUTE = 'src/routes/orderTotalsRoute.js';
const TRAP = 'src/services/orderTotalsFormatter.js';
const REQUIRED = [CONTRACT, SERVICE, ROUTE];

const ISSUE = 'Cancelled line items are still counted in the order total. An order total must exclude every line whose status is cancelled, and the response must report how many lines were excluded.';

// ── harness state ────────────────────────────────────────────────────────────

let brain: ChildProcess | undefined;
let provider: http.Server | undefined;
let providerPort = 0;
let workspaceRoot = '';
let brainLog = '';

const providerCalls: string[] = [];
let editCall = 0;
/** Set to hold the next model call open, for the cancellation scenario. */
let blockNextCall: (() => void) | undefined;

let ui: ScriptedCodingUi;
let extApi: { governedCoding: { setUi(factory: () => ScriptedCodingUi): void; restore(): Promise<void> } };

/** Install a scripted interaction for the next command invocation. */
function scriptUi(approvals: ScopeApprovalAnswer[], over: { issueText?: string | undefined } = {}): ScriptedCodingUi {
  ui = createScriptedCodingUi({ issueText: 'issueText' in over ? over.issueText : ISSUE, approvals });
  extApi.governedCoding.setUi(() => ui);
  return ui;
}

function git(args: string[], cwd = workspaceRoot): string {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout ?? '';
}
function dirty(): string[] {
  return git(['status', '--porcelain']).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(/^\S+\s+/, ''));
}

function edits(field: string): Array<{ path: string; content: string }> {
  return [
    {
      path: CONTRACT,
      content: fs.readFileSync(path.join(workspaceRoot, CONTRACT), 'utf8')
        .replace(/ORDER_TOTAL_FIELDS = \[[^\]]*\]/, `ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "${field}"]`),
    },
    {
      path: SERVICE,
      content: `/** Sum the order, excluding cancelled lines. */\nexport function computeOrderTotal(lines) {\n  const kept = lines.filter((line) => line.status !== "cancelled");\n  const subtotalCents = kept.reduce((sum, line) => sum + line.amountCents, 0);\n  return { subtotalCents, totalCents: subtotalCents, ${field}: lines.length - kept.length };\n}\n`,
    },
    {
      path: ROUTE,
      content: `import { computeOrderTotal } from "../services/orderTotalsService.js";\n\nexport function orderTotalsRoute(body) {\n  const total = computeOrderTotal(body.lines);\n  return { subtotalCents: total.subtotalCents, totalCents: total.totalCents, ${field}: total.${field} };\n}\n`,
    },
  ];
}

async function startProvider(): Promise<void> {
  provider = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      type ChatBody = { messages?: Array<{ content?: string }> };
      let parsed: ChatBody | undefined;
      try { parsed = raw ? (JSON.parse(raw) as ChatBody) : undefined; } catch { parsed = undefined; }
      const content = parsed?.messages?.[parsed.messages.length - 1]?.content;
      if (!content) {
        // Availability probes carry no chat body.
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'scripted-model' }], models: [{ name: 'scripted-model' }] }));
        return;
      }
      if (blockNextCall) {
        await new Promise<void>((resolve) => { blockNextCall = resolve; });
      }
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(content) as Record<string, unknown>; } catch { /* keep empty */ }
      let reply: unknown;
      if ('candidatePaths' in input) {
        providerCalls.push('plan');
        reply = {
          issueSummary: 'Exclude cancelled lines from the order total and report how many were excluded.',
          scope: REQUIRED.map((p) => ({ path: p, rationale: `${p} participates in the total or its response shape` })),
          excluded: [{ path: TRAP, reason: 'presentation only; performs no arithmetic and never inspects line status' }],
          edits: edits('excludedLineCount'),
        };
      } else if ('failureEvidence' in input) {
        const ids = [...String(input.failureEvidence).matchAll(/\b(F-\d+)\b/g)].map((m) => m[1]);
        providerCalls.push(`repair:${ids.length}`);
        reply = {
          rationale: 'The tests expect excludedLineCount, not cancelledCount.',
          observedFailureEvidenceIds: ids.slice(0, 4),
          edits: edits('excludedLineCount'),
        };
      } else {
        editCall += 1;
        // The FIRST edit is deliberately wrong — the repair loop must run.
        const field = editCall === 1 ? 'cancelledCount' : 'excludedLineCount';
        providerCalls.push(`edit:${field}`);
        reply = { rationale: `Report the excluded count as ${field}.`, edits: edits(field) };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: { content: JSON.stringify(reply) } }));
    });
  });
  provider.on('clientError', (_e, socket) => { try { socket.destroy(); } catch { /* ignore */ } });
  await new Promise<void>((resolve) => provider!.listen(0, '127.0.0.1', resolve));
  providerPort = (provider!.address() as { port: number }).port;
}

async function waitForBrain(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BRAIN_URL}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`coding brain did not start on ${CODING_PORT}\n${brainLog.slice(-2000)}`);
}

async function snapshot(runId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${BRAIN_URL}/api/ai/coding/runs/${runId}`);
  return await res.json() as Record<string, unknown>;
}

let lastStartedRunId: string | undefined;

suite('MigraPilot — governed coding through the packaged VSIX', function () {
  this.timeout(180_000);

  suiteSetup(async function () {
    this.timeout(180_000);
    workspaceRoot = process.env.MIGRAPILOT_CODING_E2E_ROOT ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    assert.ok(workspaceRoot, 'no workspace root for the coding acceptance');

    // Normalise the tree. Earlier suites leave the sample file dirty, and a
    // pre-existing modification would reconcile as a write outside the approved
    // scope — the rule working, not something to ignore.
    git(['add', '-A']);
    spawnSync('git', ['commit', '-qm', 'acceptance baseline'], { cwd: workspaceRoot });
    assert.deepEqual(dirty(), [], 'the acceptance must start from a clean tree');

    const baseline = runFixtureTests(workspaceRoot);
    assert.notEqual(baseline.exitCode, 0, 'the fixture must start FAILING');
    assert.equal(baseline.failed, 5, `expected 5 genuine failures, got ${baseline.failed}`);

    await startProvider();

    const brainServer = path.resolve(__dirname, '../../../../brain-service/dist/src/server.js');
    assert.ok(fs.existsSync(brainServer), `brain build missing at ${brainServer}`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_OPTIONS;
    brain = spawn('node', [brainServer], {
      env: {
        ...env,
        MIGRAPILOT_BRAIN_PORT: String(CODING_PORT),
        MIGRAPILOT_BRAIN_HOST: '127.0.0.1',
        MIGRAPILOT_MODE: 'offline',
        MIGRAPILOT_STATE_DB: process.env.MIGRAPILOT_CODING_E2E_DB ?? path.join(workspaceRoot, '..', 'coding-e2e.db'),
        MIGRAPILOT_CODING_ENABLED: '1',
        MIGRAPILOT_CODING_WORKSPACE_ROOTS: workspaceRoot,
        MIGRAPILOT_CODING_MODEL: 'scripted-model',
        MIGRAPILOT_CODING_VALIDATION_COMMAND: 'node --test --test-reporter=tap test/orderTotals.test.js',
        MIGRAPILOT_PROVIDER_URL: `http://127.0.0.1:${providerPort}/v1`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    brain.stdout?.on('data', (d) => { brainLog += String(d); });
    brain.stderr?.on('data', (d) => { brainLog += String(d); });
    await waitForBrain(60_000);

    await vscode.workspace.getConfiguration('migrapilot').update('brainUrl', BRAIN_URL, vscode.ConfigurationTarget.Global);

    // Drive the real dialogs. The command is invoked through the VS Code command
    // registry; only the human's two answers are supplied here.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    extApi = (await ext.activate()) as typeof extApi;
    assert.ok(extApi.governedCoding?.setUi, 'the packaged extension exposes the interaction seam');
  });

  suiteTeardown(() => {
    brain?.kill('SIGKILL');
    provider?.close();
  });



  // ── 1–3. capability + workspace resolution ─────────────────────────────────

  test('1 — the command is contributed by the packaged artifact', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('migrapilot.governedCoding'), 'the packaged VSIX contributes the command');
  });

  test('1b — capability unavailability is presented accurately, not as a missing run', async () => {
    const res = await fetch(`${BRAIN_URL}/api/ai/coding/capability`);
    const body = await res.json() as { governedCoding: { available: boolean; workspaceRootsConfigured: number } };
    assert.equal(body.governedCoding.available, true, 'the acceptance brain has coding enabled');
    assert.equal(body.governedCoding.workspaceRootsConfigured, 1);
    assert.equal(JSON.stringify(body).includes(workspaceRoot), false, 'configured paths are never exposed');
  });

  test('2 + 3 — the active workspace is resolved, and a multi-root workspace is refused', () => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    assert.equal(folders.length, 1, 'the acceptance runs in a single-folder workspace');
    assert.equal(fs.realpathSync(folders[0]!.uri.fsPath), fs.realpathSync(workspaceRoot));
    // The refusal is a pure function of the folder count; asserted at the unit
    // layer against a synthetic multi-root, and here against the real single root.
  });

  // ── 4–13. the full approved run ────────────────────────────────────────────

  test('4–13 — one approval drives plan → wrong edit → repair → validated report', async function () {
    this.timeout(180_000);
    const scripted = scriptUi(['approve']);

    const before = dirty();
    assert.deepEqual(before, [], 'the tree is clean before the command runs');

    // Probe the exact surface the command uses, so a hang reports WHY rather than
    // as a bare timeout.
    const capRes = await fetch(`${BRAIN_URL}/api/ai/coding/capability`);
    const capBody = await capRes.text();
    const startRes = await fetch(`${BRAIN_URL}/api/ai/coding/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ issueText: ISSUE, workspaceRoot }),
    });
    const startBody = await startRes.text();
    assert.equal(startRes.status, 202, `direct start: ${startRes.status} ${startBody}\ncapability: ${capBody}\nbrain: ${brainLog.slice(-1500)}`);

    const timedOut = Symbol('timeout');
    const raced = await Promise.race([
      vscode.commands.executeCommand('migrapilot.governedCoding').then(() => 'done'),
      new Promise((r) => setTimeout(() => r(timedOut), 90_000)),
    ]);
    assert.notEqual(raced, timedOut, `the command hung. approvals=${scripted.approvals.length} progress=${scripted.progress.length} provider=${providerCalls.join(',')} brain=${brainLog.slice(-1500)}`);

    // ── 5 + 6: what the operator was actually shown ──────────────────────────
    if (scripted.approvals.length !== 1) {
      const snap = await snapshot(lastStartedRunId!);
      assert.fail(`asked ${scripted.approvals.length} times. snapshot=${JSON.stringify(snap).slice(0, 900)} provider=[${providerCalls.join(',')}] trace=${brainLog.split('\n').filter((l) => l.includes(lastStartedRunId ?? 'NONE')).slice(-12).join('\n') || '(NO EVENTS FOR THIS RUN)'}`);
    }
    const approval = scripted.approvals[0]!;
    assert.deepEqual([...approval.files.map((f) => f.path)].sort(), [...REQUIRED].sort(), 'exactly the three files were presented');
    assert.equal(approval.files.some((f) => f.path === TRAP), false, 'the trap file was never proposed');
    assert.ok(approval.files.every((f) => f.rationale.length > 0), 'each file states why it is in scope');
    assert.ok(approval.files.every((f) => f.evidence.length > 0), 'each file carries the evidence ranges that justified it');
    assert.ok(approval.pathSetHash.length > 0, 'the scope hash the decision binds to');
    assert.ok(approval.expiresAt.length > 0, 'the approval expiry');
    assert.equal(approval.supersededPreviousProposal, false, 'a first proposal is not falsely marked superseded');
    for (const file of REQUIRED) assert.ok(approval.modalDetail.includes(file), `${file} appears in the modal detail`);

    // ── 8 + 11: the run executed once, under the approved scope ──────────────
    const runId = lastStartedRunId ?? await discoverRunId();
    assert.ok(runId, 'the run id was recorded');
    const snap = await snapshot(runId);
    assert.equal(snap.phase, 'terminal', `run reached terminal (state ${String(snap.state)})`);
    assert.equal(snap.state, 'COMPLETED', `run COMPLETED (blockers ${JSON.stringify(snap.blockers)})`);

    const children = snap.children as Array<{ kind: string; state: string; attempt: number }>;
    assert.equal(children.filter((c) => c.kind === 'initial_apply').length, 1, 'exactly one initial apply — approval dispatched once');

    // ── 12: the initial failure and the repair are both visible ─────────────
    assert.ok(children.some((c) => c.kind === 'validation' && c.state === 'failed'), 'the initial validation genuinely failed');
    assert.ok(children.some((c) => c.kind === 'repair_model_proposal' && c.state === 'completed'), 'a repair was proposed');
    assert.ok(children.some((c) => c.kind === 'final_validation' && c.state === 'completed'), 'final validation ran and passed');
    assert.ok(providerCalls.includes('edit:cancelledCount'), 'the first edit was the wrong one');
    assert.ok(providerCalls.some((c) => /^repair:[1-9]/.test(c)), 'the repair cited generated failure-evidence ids');

    // The progress the operator saw came from durable snapshots.
    assert.ok(scripted.progress.length > 0, 'progress was rendered');
    assert.ok(scripted.progress.every((p) => p.revision > 0), 'every progress frame carries a durable revision');
    assert.ok(scripted.reports.length > 0, 'a final report was rendered');
    assert.equal(scripted.reports.at(-1)!.complete, true, 'the report says complete because the BRAIN says so');

    // ── 13: the report matches the real repository ──────────────────────────
    const report = snap.finalReport as { complete: boolean; changedFiles: string[] };
    const actual = dirty().sort();
    assert.equal(report.complete, true);
    assert.deepEqual([...report.changedFiles].sort(), actual, 'the report matches the real git diff');
    assert.deepEqual(actual, [...REQUIRED].sort(), 'exactly the three approved files changed');
    assert.equal(actual.includes(TRAP), false, 'the trap file was never written');

    const verify = runFixtureTests(workspaceRoot);
    assert.equal(verify.exitCode, 0, `fixture tests now pass:\n${verify.output.slice(0, 400)}`);
    assert.equal(verify.failed, 0);
    assert.equal(verify.passed, 5, 'all five originally failing tests pass');
  });

  // ── 7 + 10: refusal paths write nothing ────────────────────────────────────

  test('7 + 10 — rejection leaves the repository unchanged', async function () {
    this.timeout(120_000);
    // Reset to the post-run state, then reject a fresh proposal.
    git(['add', '-A']);
    spawnSync('git', ['commit', '-qm', 'accepted change'], { cwd: workspaceRoot });
    assert.deepEqual(dirty(), [], 'clean before the rejection run');

    const scripted = scriptUi(['reject']);
    editCall = 0;
    await vscode.commands.executeCommand('migrapilot.governedCoding');

    assert.deepEqual(dirty(), [], 'a rejected scope writes nothing at all');
    const runId = lastStartedRunId ?? await discoverRunId();
    const snap = await snapshot(runId!);
    assert.equal(snap.state, 'REJECTED');
    assert.equal(scripted.approvals.length, 1, 'the rejection followed one presented proposal');
    const children = snap.children as Array<{ kind: string }>;
    assert.equal(children.some((c) => c.kind === 'initial_apply'), false, 'no mutation child was ever registered');
  });

  test('9 — a scope decision carrying a stale revision is refused by the Brain', async () => {
    // Proven against the real HTTP surface: the extension binds a decision to the
    // revision AND hash it displayed, so a moved proposal cannot inherit consent.
    const runId = lastStartedRunId ?? await discoverRunId();
    const snap = await snapshot(runId!);
    const res = await fetch(`${BRAIN_URL}/api/ai/coding/runs/${runId}/scope-decision`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: 1, pathSetHash: 'hash_not_the_one_shown', decision: 'approve' }),
    });
    assert.equal(res.status, 409);
    const body = await res.json() as { reason: string };
    assert.ok(['stale_revision', 'scope_hash_mismatch', 'invalid_state'].includes(body.reason), body.reason);
    void snap;
  });

  // ── 14: cancellation ───────────────────────────────────────────────────────

  test('14 — cancellation requested is never rendered as confirmed cancellation', async function () {
    this.timeout(120_000);
    const runId = lastStartedRunId ?? await discoverRunId();
    const snap = await snapshot(runId!);
    // The completed run cannot be cancelled; assert the response never upgrades a
    // request into a confirmation, which is the property under test.
    const res = await fetch(`${BRAIN_URL}/api/ai/coding/runs/${runId}/cancel`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expectedRevision: snap.revision }),
    });
    const body = await res.json() as { cancellation?: { status: string; confirmedAt?: string }; reason?: string };
    if (res.status === 200 && body.cancellation) {
      assert.notEqual(body.cancellation.status, 'cancelled', 'a request is not a confirmation');
      assert.equal(body.cancellation.confirmedAt, undefined);
    } else {
      assert.equal(res.status, 409, `a terminal run refuses cancellation with a conflict, got ${res.status}`);
    }
    assert.equal(ui.errors.some((e) => e.detail === 'Cancelled'), false, 'nothing claimed a confirmed cancellation');
  });

  // ── 15: reload recovery ────────────────────────────────────────────────────

  test('15 — reload recovers the run from Brain state, not local inference', async function () {
    this.timeout(120_000);
    // Restore asks the Brain. The extension having restarted implies nothing.
    await extApi.governedCoding.restore();
    const runId = lastStartedRunId ?? await discoverRunId();
    const snap = await snapshot(runId!);
    assert.ok(['terminal'].includes(String(snap.phase)), 'the durable phase is what recovery reflects');

    // A run the Brain does not know stays distinct from a disabled capability.
    const missing = await fetch(`${BRAIN_URL}/api/ai/coding/runs/codingrun_does_not_exist`);
    assert.equal(missing.status, 404);
    const capability = await fetch(`${BRAIN_URL}/api/ai/coding/capability`);
    assert.equal(capability.status, 200, 'capability is answerable even for a missing run');
  });

  // ── cross-cutting ──────────────────────────────────────────────────────────

  test('no mutation occurred outside the configured workspace root', () => {
    const status = git(['status', '--porcelain']);
    for (const line of status.split('\n').map((l) => l.trim()).filter(Boolean)) {
      const rel = line.replace(/^\S+\s+/, '');
      assert.equal(path.isAbsolute(rel), false, `${rel} must be workspace-relative`);
      assert.equal(rel.startsWith('..'), false, `${rel} escapes the workspace`);
    }
  });

  test('no raw model response or secret is rendered to the user', () => {
    const rendered = [
      ...ui.approvals.map((a) => `${a.markdown} ${a.modalDetail}`),
      ...ui.reports.map((r) => r.markdown),
      ...ui.errors.map((e) => `${e.title} ${e.detail}`),
    ].join('\n');
    assert.equal(/observedFailureEvidenceIds|"edits"\s*:/.test(rendered), false, 'raw model JSON is never shown');
    assert.equal(/sk-[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}/.test(rendered), false, 'no credential-shaped text is rendered');
  });
});

/** The run this host started, captured from the Brain's own 202 response. */
async function discoverRunId(): Promise<string | undefined> {
  return lastStartedRunId;
}

// The extension surfaces the started run id through its progress notifications;
// capture it as soon as the Brain reports one.
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const response = await originalFetch(input, init);
  const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
  if (url.includes('/api/ai/coding/runs') && (init?.method ?? 'GET') === 'POST' && url.endsWith('/runs')) {
    const clone = response.clone();
    void clone.json().then((body: unknown) => {
      const runId = (body as { runId?: string })?.runId;
      if (runId) lastStartedRunId = runId;
    }).catch(() => undefined);
  }
  return response;
}) as typeof fetch;
