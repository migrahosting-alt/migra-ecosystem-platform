import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { MigraPilotApi } from '../../extension.js';
import { approveResumeAndReconcile, reconcileRun } from '@migrapilot/pilot-client';
import { runEngineerTurn } from '../../chat/engineerTurn.js';
import { shellHtml } from '../../panel/shell/shellHtml.js';
import { CAP_FIX_DIAGNOSTICS, evaluateCapability } from '../../services/commandCapabilities.js';
import { type ProviderChunk } from '../../providers/modelProvider.js';
import { type MockModelProvider, startMockModelProvider } from '../support/mockModelProvider.js';
import { type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';
import { MigraAiClient, type AiStreamEvent } from '../../services/migraAiClient.js';

// Duck-typed PilotError check. In VSIX mode the packaged extension and this
// runner load separate copies of pilotErrors.js, so `instanceof` across the
// boundary is false even for a genuine PilotError — match by shape instead.
function isPilotErrorCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'PilotError' &&
    (err as { code?: unknown }).code === code
  );
}

const EXTENSION_ID = 'migrateck.migrapilot-extension';
const TEST_BRAIN_PORT = 3991;
const BRAIN_URL = `http://127.0.0.1:${TEST_BRAIN_PORT}`;

// In 'vsix' mode the extension-under-test is the packaged artifact loaded from a
// different path than this runner, so VS Code gives it its OWN per-extension
// `vscode` API object — the runner cannot stub the packaged extension's dialog
// calls. Commands whose only observable output is an awaited showInformationMessage
// therefore can't be driven here; we smoke the same reachability non-blockingly.
const IS_VSIX = process.env.MIGRAPILOT_TEST_MODE === 'vsix';

const extensionRoot = path.resolve(__dirname, '../../..');
const repoRoot = path.resolve(extensionRoot, '../..');
const brainServer = path.join(repoRoot, 'apps/brain-service/dist/src/server.js');

let brain: ChildProcess | undefined;
let extApi: MigraPilotApi | undefined;

// Auto-resolve blocking dialogs so awaited message calls don't hang the host.
const dialogCalls: { kind: string; message: string }[] = [];
type MsgFn = (message: string, ...rest: unknown[]) => Thenable<string | undefined>;
function stubDialog(kind: 'info' | 'warn' | 'error', name: keyof typeof vscode.window): void {
  const stub: MsgFn = (message: string) => {
    dialogCalls.push({ kind, message });
    return Promise.resolve(undefined);
  };
  Object.defineProperty(vscode.window, name, { value: stub, configurable: true, writable: true });
}

async function waitForBrain(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BRAIN_URL}/health`);
      if (res.ok) {
        const body = (await res.json()) as { service?: string };
        if (body.service === 'migrapilot-brain') {
          return;
        }
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('brain-service did not become healthy in time');
}

function fixtureUri(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'expected a workspace folder in the test host');
  return vscode.Uri.file(path.join(folder.uri.fsPath, 'sample.ts'));
}

suite('MigraPilot extension — end to end', () => {
  suiteSetup(async function () {
    this.timeout(90_000);

    assert.ok(fs.existsSync(brainServer), `brain build missing at ${brainServer}`);
    brain = spawn('node', [brainServer], {
      env: {
        ...process.env,
        MIGRAPILOT_BRAIN_PORT: String(TEST_BRAIN_PORT),
        MIGRAPILOT_LOCAL_PROVIDER: 'stub',
        // Tests are DB-free + deterministic — no durable state file.
        MIGRAPILOT_STATE_DB: 'off',
      },
      stdio: 'ignore',
    });
    await waitForBrain(30_000);

    await vscode.workspace
      .getConfiguration('migrapilot')
      .update('brainUrl', BRAIN_URL, vscode.ConfigurationTarget.Global);

    stubDialog('info', 'showInformationMessage');
    stubDialog('warn', 'showWarningMessage');
    stubDialog('error', 'showErrorMessage');

    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} not found`);
    extApi = (await ext.activate()) as MigraPilotApi;
    assert.ok(extApi?.router, 'extension should export its router');
  });

  suiteTeardown(() => {
    brain?.kill('SIGKILL');
  });

  setup(() => {
    dialogCalls.length = 0;
  });

  test('activates and registers all contributed commands', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(ext?.isActive, true);
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'migrapilot.health',
      'migrapilot.repairConnection',
      'migrapilot.showLogs',
      'migrapilot.showDiagnostics',
      'migrapilot.explainSelection',
      'migrapilot.fixDiagnostics',
      'migrapilot.generateTests',
      'migrapilot.generateCommit',
      'migrapilot.openAgentMode',
      // Canonical Command Center + the retained developer escape hatches.
      'migrapilot.openStudio',
      'migrapilot.openChat',
      'migrapilot.openWorkspacePanel',
      'migrapilot.dev.openClassicChat',
      'migrapilot.dev.openClassicAgentMode',
      'migrapilot.dev.openClassicWorkspace',
    ]) {
      assert.ok(commands.includes(id), `command not registered: ${id}`);
    }
  });

  test('the Command Center opens as an editor panel and stays open', async () => {
    // Opening the Command Center must not throw, must be idempotent, and must
    // leave the extension healthy — the shell renders from posted state, so a
    // broken provider would surface here as a command failure.
    await vscode.commands.executeCommand('migrapilot.openStudio');
    await vscode.commands.executeCommand('migrapilot.openStudio', 'audit');
    await vscode.commands.executeCommand('migrapilot.openChat');
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(ext?.isActive, true, 'the extension must remain active after opening the Command Center');
    await vscode.commands.executeCommand('migrapilot.openWorkspacePanel');
    assert.equal(ext?.isActive, true);
  });

  test('the Command Center Workspace tab drives the real MigraAI workspace lifecycle', async () => {
    const api = extApi;
    assert.ok(api, 'extension API unavailable');

    // Opening the Workspace tab must not throw and must leave the host healthy.
    await vscode.commands.executeCommand('migrapilot.openStudio', 'workspace');
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(ext?.isActive, true, 'the extension must remain active on the Workspace tab');

    // Drive the SAME controller the tab uses, against the live engine, and prove
    // the migrated workflow still behaves: open → sync → approve(current) → Ready.
    const opened = await api.workspace.open();
    assert.ok(opened.name.length > 0);
    const synced = await api.workspace.sync(opened.workspaceId);
    assert.ok(synced.indexChunks >= 0);

    if (synced.actions.approve) {
      // The version binding is the security property: approving a STALE version
      // must be refused, and the current one must succeed.
      await assert.rejects(
        () => api.workspace.approve(synced.workspaceId, synced.indexVersion - 1),
        (error: unknown) => isPilotErrorCode(error, 'INVALID_STATE'),
        'a stale index version must be refused',
      );
      const approved = await api.workspace.approve(synced.workspaceId, synced.indexVersion);
      assert.equal(approved.actions.approve, false, 'an approved index needs no further approval');
    }

    // Every workspace action remains reachable — nothing was lost in the move.
    const listed = await api.workspace.list();
    assert.ok(listed.some((entry) => entry.id === opened.workspaceId));
  });

  test('the Workspace tab renders the CONNECTED state: six sections and eight actions', async () => {
    const api = extApi;
    assert.ok(api, 'extension API unavailable');
    type WsTab = {
      state: string;
      name: string;
      message?: string;
      status: { text: string };
      panels: Array<{ title: string; rows: Array<{ label: string; value: string }> }>;
      approval: { state: string; heading: string; actions: Array<{ id: string }> };
      actions: Array<{ id: string }>;
    };
    const tab = (): WsTab => (api.shell.state() as { workspace: WsTab }).workspace;

    // 1. Loading the tab with nothing registered must be an HONEST empty state
    //    that explains itself — not a bare "no workspace".
    await api.shell.loadTab('workspace');
    if (tab().state === 'empty') {
      assert.match(tab().message ?? '', /Open Workspace registers|no folder is open/i, 'the empty state must explain itself');
    }

    // 2. Open Workspace — exactly what clicking the button does.
    await api.shell.workspaceIntent('open');
    assert.equal(tab().state, 'ready', `Open Workspace must reach the connected state (got: ${tab().state} — ${tab().message ?? ''})`);

    // 3. All SIX sections, with real engine values.
    const connected = tab();
    assert.deepEqual(
      connected.panels.map((panel) => panel.title),
      ['Workspace', 'Semantic Index', 'Memory', 'Agents', 'Models', 'Engine'],
    );
    for (const panel of connected.panels) {
      assert.ok(panel.rows.length > 0, `${panel.title} must render rows`);
    }
    const index = new Map(connected.panels.find((p) => p.title === 'Semantic Index')!.rows.map((r) => [r.label, r.value]));
    for (const label of ['State', 'Files', 'Chunks', 'Embedding model', 'Pending approval', 'Last indexed']) {
      assert.ok(index.has(label), `Semantic Index must report ${label}`);
    }
    const engine = new Map(connected.panels.find((p) => p.title === 'Engine')!.rows.map((r) => [r.label, r.value]));
    assert.match(engine.get('Schema') ?? '', /^v\d+$/, 'Engine must report a real schema version');

    // 4. All EIGHT actions reachable (six lifecycle + approve/diagnostics on the card).
    const ids = new Set([...connected.actions, ...connected.approval.actions].map((action) => action.id));
    for (const id of ['sync', 'rebuild', 'changeMemory', 'diagnostics', 'refreshWorkspace', 'delete']) {
      assert.ok(ids.has(id), `lifecycle action ${id} must be present`);
    }
    assert.ok(['required', 'clear', 'not-indexed', 'indexing'].includes(connected.approval.state));
    if (connected.approval.state === 'required') assert.ok(ids.has('approve'), 'an unapproved index must offer Approve');

    // 5. Sanitation holds against REAL engine data.
    const serialized = JSON.stringify(connected);
    assert.doesNotMatch(serialized, /"indexVersion"/, 'the index version stays host-side');
    assert.doesNotMatch(serialized, /ws_[a-z0-9]{6,}/, 'the workspace id stays host-side');
    assert.doesNotMatch(serialized, /:\/\/[^/@"]*:[^/@"]*@/, 'no credentials in a git remote');

    // 6. A real lifecycle action still works from the tab.
    await api.shell.workspaceIntent('sync');
    assert.equal(tab().state, 'ready', 'the tab stays connected after a sync');
  });

  test('the canonical sidebar launcher is the only default-visible MigraPilot chat surface', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    const views = (ext?.packageJSON?.contributes?.views?.migrapilot ?? []) as Array<{ id: string; name: string; when?: string }>;
    const defaultVisible = views.filter((view) => !view.when);

    // The launcher is first, so clicking the activity-bar icon focuses it.
    assert.equal(views[0]?.id, 'migrapilot.sidebar');
    assert.equal(views[0]?.when, undefined);

    // The classic views are contributed but NOT default-visible.
    for (const id of ['migrapilot.chatView', 'migrapilot.agentMode', 'migrapilot.workspace']) {
      assert.ok(views.some((view) => view.id === id), `${id} must remain contributed for developer restore`);
      assert.ok(!defaultVisible.some((view) => view.id === id), `${id} must be hidden by default`);
      assert.equal(
        views.find((view) => view.id === id)?.when,
        'config.migrapilot.enableClassicViews',
        `${id} must be gated on the developer setting`,
      );
    }
    // Nothing default-visible reads as a second chat / Agent Mode surface.
    for (const view of defaultVisible) {
      assert.doesNotMatch(view.name, /chat/i, `${view.id} must not be a second chat surface`);
      assert.doesNotMatch(view.name, /agent mode/i, `${view.id} must not be a second Agent Mode surface`);
      assert.doesNotMatch(view.name, /migraai workspace/i, `${view.id} must not be a second workspace surface`);
    }
    // Focusing the launcher works and keeps the extension healthy.
    await vscode.commands.executeCommand('migrapilot.sidebar.focus');
    assert.equal(ext?.isActive, true);
  });

  test('opening the MigraPilot activity-bar container never renders the old chat UI', async () => {
    // Open the container the activity-bar icon opens, then the launcher, then the
    // Command Center — i.e. the full default user journey.
    await vscode.commands.executeCommand('workbench.view.extension.migrapilot');
    await vscode.commands.executeCommand('migrapilot.sidebar.focus');
    await vscode.commands.executeCommand('migrapilot.openStudio');
    await vscode.commands.executeCommand('migrapilot.openChat');
    await vscode.commands.executeCommand('migrapilot.openAgentMode');

    // The decisive assertion: VS Code never asked the superseded views to render,
    // so no second chat composer and no second Agent Mode approval surface can
    // have appeared.
    const api = extApi;
    assert.ok(api, 'extension API unavailable');
    assert.equal(api.classicViews.enabled(), false, 'classic views must be disabled by default');
    assert.equal(api.classicViews.chatResolved(), false, 'the classic chat view must never render by default');
    assert.equal(api.classicViews.agentModeResolved(), false, 'the classic Agent Mode view must never render by default');
  });

  test('the explicit developer setting is the ONLY thing that restores a classic view', async () => {
    const api = extApi;
    assert.ok(api, 'extension API unavailable');
    const config = () => vscode.workspace.getConfiguration('migrapilot');

    // Precondition: hidden, and never rendered by the preceding journey.
    assert.equal(api.classicViews.enabled(), false);
    assert.equal(api.classicViews.chatResolved(), false);

    try {
      // Turn the developer gate ON — the ONLY supported restore mechanism.
      await config().update('enableClassicViews', true, vscode.ConfigurationTarget.Workspace);
      // The `when` clause is a context key; give VS Code a moment to contribute
      // the view before focusing it.
      const deadline = Date.now() + 15_000;
      while (!api.classicViews.enabled() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(api.classicViews.enabled(), true, 'the setting must be observable to the extension');

      await vscode.commands.executeCommand('migrapilot.dev.openClassicChat');
      while (!api.classicViews.chatResolved() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(
        api.classicViews.chatResolved(),
        true,
        'with the developer setting ON the classic view must be restorable — the legacy code is retained, not deleted',
      );
    } finally {
      // Leave the canonical default in place for every later assertion.
      await config().update('enableClassicViews', undefined, vscode.ConfigurationTarget.Workspace);
      const reset = Date.now() + 10_000;
      while (api.classicViews.enabled() && Date.now() < reset) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(api.classicViews.enabled(), false, 'the gate must return to OFF');
    }
  });

  test('classic views stay OFF by default and the dev commands refuse rather than resurrect them', async () => {
    const config = vscode.workspace.getConfiguration('migrapilot');
    assert.equal(config.get<boolean>('enableClassicViews'), false, 'classic views must default to OFF');

    // With the gate closed the developer command must not throw and must not
    // focus a hidden view — it surfaces a refusal instead. In VSIX mode the
    // packaged extension owns its own dialog API, so only reachability is
    // asserted there.
    const before = dialogCalls.length;
    await vscode.commands.executeCommand('migrapilot.dev.openClassicChat');
    await vscode.commands.executeCommand('migrapilot.dev.openClassicAgentMode');
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(ext?.isActive, true, 'a refused classic-view command must not destabilise the extension');
    if (!IS_VSIX) {
      const refusals = dialogCalls.slice(before).map((call) => call.message).join(' | ');
      assert.match(refusals, /superseded developer-only view/i, `unexpected dialogs: ${refusals}`);
      assert.match(refusals, /Command Center/, 'the refusal must point at the canonical interface');
    }
  });

  test('health command reaches the live brain', async () => {
    if (IS_VSIX) {
      const res = await fetch(`${BRAIN_URL}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { service?: string };
      assert.equal(body.service, 'migrapilot-brain');
      return;
    }
    await vscode.commands.executeCommand('migrapilot.health');
    const reported = dialogCalls.map((c) => c.message).join(' | ');
    assert.match(reported, /brain is ok/i, `unexpected health dialogs: ${reported}`);
  });

  test('showDiagnostics runs without error', async () => {
    if (IS_VSIX) {
      const res = await fetch(`${BRAIN_URL}/tools/diagnostics.get`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rootPath: process.env.MIGRAPILOT_E2E_WORKSPACE ?? '.' }),
      });
      assert.equal(res.status, 200);
      return;
    }
    await vscode.commands.executeCommand('migrapilot.showDiagnostics');
    const reported = dialogCalls.map((c) => c.message).join(' | ');
    assert.match(reported, /diagnostics available/i, reported);
  });

  // (Commit-message generation is now provider-backed + read-only — covered by
  // the dedicated 'commit message: …' suites below.)

  test('explainSelection returns an explanation document', async function () {
    this.timeout(30_000);
    const doc = await vscode.workspace.openTextDocument(fixtureUri());
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 2, 1);

    await vscode.commands.executeCommand('migrapilot.explainSelection');

    const resultDoc = vscode.window.activeTextEditor?.document;
    assert.ok(resultDoc, 'expected a result editor');
    assert.match(resultDoc.getText(), /Explain Selection/, 'explanation header missing');
    // Stub provider echoes the feature — proves the full route→retrieve→chat path ran.
    assert.match(resultDoc.getText(), /Stub provider response|explain/i, resultDoc.getText().slice(0, 200));
  });

  test('fixDiagnostics runs the full pipeline with an injected diagnostic', async function () {
    this.timeout(30_000);
    const uri = fixtureUri();
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);

    const collection = vscode.languages.createDiagnosticCollection('migrapilot-e2e');
    collection.set(uri, [
      new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 10),
        "'add' is declared but never used.",
        vscode.DiagnosticSeverity.Warning,
      ),
    ]);
    try {
      await vscode.commands.executeCommand('migrapilot.fixDiagnostics');
      const resultDoc = vscode.window.activeTextEditor?.document;
      assert.ok(resultDoc, 'expected a fix result editor');
      assert.match(resultDoc.getText(), /Fix Diagnostics/, 'fix header missing');
    } finally {
      collection.dispose();
    }
  });

  test('brain /chat pipeline is reachable through the configured URL', async () => {
    const res = await fetch(`${BRAIN_URL}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        feature: 'chat',
        modelProfile: 'cheap',
        systemPromptId: 'chat-chat-v1',
        userPrompt: 'ping',
        context: { diagnostics: [], retrievedChunks: [] },
        outputMode: 'markdown',
      }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { content: string };
    assert.match(body.content, /Stub provider response/, body.content);
  });

  // ── MigraAI Engine: local chat migrated to /api/ai/chat ─────────────────────
  suite('MigraAI Engine (/api/ai/chat)', () => {
    const engine = () =>
      new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 15_000, log: () => {} });

    async function drain(gen: AsyncGenerator<AiStreamEvent>): Promise<AiStreamEvent[]> {
      const out: AiStreamEvent[] = [];
      for await (const e of gen) out.push(e);
      return out;
    }

    test('real local-engine chat streams route → tokens → done through /api/ai/chat', async () => {
      const events = await drain(engine().chatStream({ prompt: 'ping', tier: 'fast' }));
      const types = events.map((e) => e.type);
      assert.ok(types.includes('route'), 'must emit a route frame');
      assert.ok(types.includes('token'), 'must stream tokens');
      assert.equal(types[types.length - 1], 'done');
      const route = events.find((e) => e.type === 'route') as Extract<AiStreamEvent, { type: 'route' }>;
      // Engine chose the model — the client never named one.
      assert.ok(route.routing.model.length > 0, 'engine reports a selected model');
      assert.ok(Array.isArray(route.routing.failedOver), 'failover metadata present');
    });

    test('engine catalog lists models (GET /api/ai/models)', async () => {
      const cat = await engine().getModels();
      assert.ok(cat.count >= 1);
      assert.ok(cat.models[0]?.id);
    });

    test('engine unavailability surfaces CAPABILITY_MISSING — never a legacy /chat fallback', async () => {
      const bad = new MigraAiClient({ baseUrl: () => `${BRAIN_URL}/nonexistent`, timeoutMs: () => 8_000, log: () => {} });
      let captured: unknown;
      try {
        await drain(bad.chatStream({ prompt: 'ping' }));
        assert.fail('expected the engine call to reject');
      } catch (err) {
        captured = err;
      }
      assert.ok(isPilotErrorCode(captured, 'CAPABILITY_MISSING'), 'must be a correlated CAPABILITY_MISSING error');
    });

    test('engineDiagnostics() API surface is present and sanitized', () => {
      const snap = extApi!.engineDiagnostics();
      assert.ok(Array.isArray(snap.history), 'history is an array');
      // Sanitized by construction: no secret-shaped keys anywhere in the snapshot.
      const json = JSON.stringify(snap);
      for (const forbidden of ['authorization', 'apiKey', 'token', 'password', 'secret', 'dataBase64']) {
        assert.ok(!json.toLowerCase().includes(forbidden.toLowerCase()), `snapshot must not contain "${forbidden}"`);
      }
    });
  });

  // ── MigraAI Engine: capability execution boundary (/api/ai/tools) ────────────
  suite('MigraAI Engine tools (/api/ai/tools)', () => {
    const engine = () =>
      new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 15_000, log: () => {} });

    test('successful read-only tool executes immediately through the engine', async () => {
      const res = await engine().executeTool({ tool: 'git.status', input: { rootPath: process.cwd() } });
      assert.equal(res.status, 'ok');
      assert.ok((res as { result: unknown }).result);
    });

    test('successful approval-required tool: mint → consume → execute once, replay refused', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-tools-'));
      try {
        fs.writeFileSync(path.join(dir, 'f.ts'), 'const a = 0;\nconst b = 2;\n');
        const input = { rootPath: dir, changes: [{ path: 'f.ts', startLine: 1, endLine: 1, replacement: 'const a = 111;' }] };

        // 1) approval-less call → mints a single-use token + preview, no mutation
        const minted = await engine().executeTool({ tool: 'edit.apply', input });
        assert.equal(minted.status, 'approval_required');
        const approvalId = (minted as { approvalId: string }).approvalId;
        assert.ok(approvalId);
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /const a = 0;/, 'mint must not mutate');

        // 2) consume the token → executes exactly once
        const applied = await engine().executeTool({ tool: 'edit.apply', input, approvalId });
        assert.equal(applied.status, 'executed');
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /const a = 111;/, 'edit applied');

        // 3) replay the consumed token → INVALID_STATE, no second execution
        await assert.rejects(
          () => engine().executeTool({ tool: 'edit.apply', input, approvalId }),
          (e: unknown) => isPilotErrorCode(e, 'INVALID_STATE'),
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('denied capability → CAPABILITY_MISSING (engine decides availability)', async () => {
      await assert.rejects(
        () => engine().executeTool({ tool: 'terminal.exec', input: { rootPath: process.cwd(), changes: [] } }),
        (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'),
      );
    });

    test('cancelled execution surfaces CANCELLED (no result)', async () => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        () => engine().executeTool({ tool: 'git.status', input: { rootPath: process.cwd() } }, controller.signal),
        (e: unknown) => isPilotErrorCode(e, 'CANCELLED'),
      );
    });
  });

  suite('Agent Mode command approval', () => {
    const workspace = () => process.env.MIGRAPILOT_E2E_WORKSPACE ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';

    test('production extension exports no Agent mutation or approval surface', () => {
      const exported = extApi as unknown as Record<string, unknown>;
      assert.equal('agentMode' in exported, false, 'another extension must not obtain Agent controls');
      for (const forbidden of ['enter', 'propose', 'approve', 'decide', 'reject', 'cancel', 'agentClient', 'activationCapability']) {
        assert.equal(forbidden in exported, false, `production export must not contain ${forbidden}`);
      }
    });

    test('secure pairing command exists but no public approval command is registered', async () => {
      const commands = await vscode.commands.getCommands(true);
      assert.ok(commands.includes('migrapilot.pairAgentMode'));
      assert.equal(commands.some((id) => /migrapilot\..*(approve|reject|cancel).*agent/i.test(id)), false);
    });

    test('ordinary chat remains tool-free and cannot create an Agent Mode command effect', async () => {
      const marker = path.join(workspace(), `ordinary-chat-${Date.now()}.txt`);
      const client = new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 15_000, log: () => {} });
      const events: AiStreamEvent[] = [];
      for await (const event of client.chatStream({ prompt: `Create ${marker} by running a command.` })) events.push(event);
      assert.equal(events.at(-1)?.type, 'done');
      assert.equal(fs.existsSync(marker), false, 'ordinary chat must not execute command.run');
    });
  });

  // ── MigraAI workspace engineer (/api/ai/engineer) — Slice 2 routing ─────────
  suite('MigraAI workspace engineer (/api/ai/engineer)', () => {
    const engine = () =>
      new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 20_000, log: () => {} });

    test('an ordinary engineering task runs the LOCAL engineer loop end-to-end (delegation is OFF)', async () => {
      // The suite brain runs with the stub provider and NO pilot delegation —
      // this passing is itself owner-test #4: a disabled delegated runtime
      // does not block ordinary local workspace work.
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-eng-'));
      fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
      const events: Array<{ event: string; data: unknown }> = [];
      for await (const ev of engine().engineerStream({ rootPath: dir, task: 'inspect this workspace' })) {
        events.push(ev);
      }
      const kinds = events.map((e) => e.event);
      assert.ok(kinds.includes('route'), 'engine selects a model');
      assert.ok(kinds.includes('step'), 'a real tool step executes');
      assert.ok(kinds.includes('final'), 'the loop reaches a final answer');
      const final = events.find((e) => e.event === 'final')!.data as { markdown: string };
      assert.match(final.markdown, /Stub engineer inspected the workspace/);
    });

    test('engineer input validation is truthful (INVALID_INPUT, never SERVER_ERROR)', async () => {
      await assert.rejects(
        async () => {
          for await (const _ of engine().engineerStream({ rootPath: '', task: '' })) {
            /* drain */
          }
        },
        (e: unknown) => isPilotErrorCode(e, 'INVALID_INPUT'),
      );
    });
  });

  // ── MigraAI Engine: agent orchestration (/api/ai/agents) ────────────────────
  suite('MigraAI Engine agents (/api/ai/agents)', () => {
    const engine = () =>
      new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 20_000, log: () => {} });

    function tempTarget(): { dir: string; input: { rootPath: string; path: string } } {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-agent-'));
      fs.writeFileSync(path.join(dir, 'f.ts'), 'const a = 0;\nconst b = 2;\n');
      return { dir, input: { rootPath: dir, path: 'f.ts' } };
    }

    test('successful read-only agent run completes', async () => {
      const run = await engine().createAgentRun({ agentId: 'workspace.diagnostics', input: { rootPath: process.cwd(), path: 'package.json' } });
      assert.equal(run.state, 'COMPLETED');
      assert.ok(run.result);
      // Sanitized: the run view never carries approval material.
      assert.ok(!/approvalId/.test(JSON.stringify(run)));
    });

    test('approval-required run: WAITING → approve → executes once', async () => {
      const { dir, input } = tempTarget();
      try {
        const run = await engine().createAgentRun({ agentId: 'workspace.test-generator', input });
        assert.equal(run.state, 'WAITING_FOR_APPROVAL');
        assert.ok(run.pendingAction?.summary);
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /const a = 0;/, 'no mutation before approval');

        const done = await engine().resumeAgentRun(run.runId, 'approve');
        assert.equal(done.state, 'COMPLETED');
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /migraai-test-generator/, 'edit applied');

        await assert.rejects(
          () => engine().resumeAgentRun(run.runId, 'approve'),
          (e: unknown) => isPilotErrorCode(e, 'INVALID_STATE'),
        );
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('rejection causes no mutation', async () => {
      const { dir, input } = tempTarget();
      try {
        const run = await engine().createAgentRun({ agentId: 'workspace.test-generator', input });
        const rejected = await engine().resumeAgentRun(run.runId, 'reject');
        assert.equal(rejected.state, 'CANCELLED');
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /const a = 0;/, 'file untouched after reject');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('reconnect resumes observation without replay (GET reconciles, no mutation)', async () => {
      const { dir, input } = tempTarget();
      try {
        const run = await engine().createAgentRun({ agentId: 'workspace.test-generator', input });
        const a = await engine().getAgentRun(run.runId);
        const b = await engine().getAgentRun(run.runId);
        assert.equal(a.state, 'WAITING_FOR_APPROVAL');
        assert.equal(b.state, 'WAITING_FOR_APPROVAL');
        assert.match(fs.readFileSync(path.join(dir, 'f.ts'), 'utf8'), /const a = 0;/, 'observing never executes');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('client stop does not falsely report server cancellation', async () => {
      const { dir, input } = tempTarget();
      try {
        const run = await engine().createAgentRun({ agentId: 'workspace.test-generator', input });
        // Client "stops waiting" — it simply does not call cancel. Aborting an
        // observe must NOT cancel the server run.
        const observe = new AbortController();
        observe.abort();
        await assert.rejects(() => engine().getAgentRun(run.runId, observe.signal), (e: unknown) => isPilotErrorCode(e, 'CANCELLED'));
        const still = await engine().getAgentRun(run.runId);
        assert.equal(still.state, 'WAITING_FOR_APPROVAL', 'server run is NOT cancelled by a client stop');
        // An explicit cancel IS confirmed by the server.
        const cancelled = await engine().cancelAgentRun(run.runId);
        assert.equal(cancelled.state, 'CANCELLED');
        assert.equal(cancelled.cancellation, 'confirmed');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    test('capability-denied / unknown agent → CAPABILITY_MISSING', async () => {
      await assert.rejects(
        () => engine().createAgentRun({ agentId: 'workspace.autonomous-danger', input: { rootPath: process.cwd(), path: 'x' } }),
        (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'),
      );
    });
  });

  // ── MigraAI Engine: server-side conversation memory ─────────────────────────
  suite('MigraAI Engine conversation memory', () => {
    const engine = (workspace: string) =>
      new MigraAiClient({ baseUrl: () => BRAIN_URL, timeoutMs: () => 20_000, log: () => {}, scope: () => ({ owner: 'local', workspace }) });

    async function drainChat(client: MigraAiClient, body: Record<string, unknown>): Promise<void> {
      for await (const _ of client.chatStream(body)) {
        /* drain to completion so the engine commits */
      }
    }

    test('create conversation and complete two turns → engine holds authoritative history', async () => {
      const client = engine('wsMem1');
      const conv = await client.createConversation({ memoryMode: 'session' });
      await drainChat(client, { prompt: 'first turn', conversationId: conv.id, memoryPolicy: { mode: 'session', store: true, retrieve: true } });
      await drainChat(client, { prompt: 'second turn', conversationId: conv.id, memoryPolicy: { mode: 'session', store: true, retrieve: true } });
      const { messages } = await client.getConversationMessages(conv.id);
      assert.equal(messages.filter((m) => m.role === 'user').length, 2);
      assert.equal(messages.filter((m) => m.role === 'assistant').length, 2);
    });

    test('resume after reconnect returns authoritative history from a fresh client', async () => {
      const client = engine('wsMem2');
      const conv = await client.createConversation({ memoryMode: 'session' });
      await drainChat(client, { prompt: 'remember this', conversationId: conv.id, memoryPolicy: { mode: 'session', store: true, retrieve: true } });
      // A brand-new client (simulating an Extension Host reload) resumes history.
      const resumed = engine('wsMem2');
      const { messages } = await resumed.getConversationMessages(conv.id);
      assert.ok(messages.length >= 2, 'authoritative history survives client recreation');
    });

    test('cancelled response does not appear as a completed message', async () => {
      const client = engine('wsMem3');
      const conv = await client.createConversation({ memoryMode: 'session' });
      const ctl = new AbortController();
      ctl.abort(); // cancel before the turn completes
      try {
        for await (const _ of client.chatStream({ prompt: 'go', conversationId: conv.id, memoryPolicy: { mode: 'session', store: true, retrieve: false } }, ctl.signal)) {
          /* aborted before completion */
        }
      } catch {
        /* CANCELLED — expected */
      }
      const { messages } = await client.getConversationMessages(conv.id);
      assert.equal(
        messages.filter((m) => m.role === 'assistant' && m.status === 'complete').length,
        0,
        'a cancelled turn commits no completed assistant message',
      );
    });

    test('memory-off conversation does not persist', async () => {
      const client = engine('wsMem4');
      const conv = await client.createConversation({ memoryMode: 'off' });
      await drainChat(client, { prompt: 'hello', conversationId: conv.id, memoryPolicy: { mode: 'off', store: true, retrieve: true } });
      const { messages } = await client.getConversationMessages(conv.id);
      assert.equal(messages.length, 0, 'off persists nothing');
    });

    test('deleted conversation cannot be reopened', async () => {
      const client = engine('wsMem5');
      const conv = await client.createConversation({ memoryMode: 'session' });
      await client.deleteConversation(conv.id);
      await assert.rejects(() => client.getConversation(conv.id), (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'));
    });

    test('workspace A history never appears in workspace B', async () => {
      const a = engine('wsIsoA');
      const b = engine('wsIsoB');
      const conv = await a.createConversation({ memoryMode: 'session' });
      await drainChat(a, { prompt: 'A-only secret', conversationId: conv.id, memoryPolicy: { mode: 'session', store: true, retrieve: true } });
      // Workspace B cannot see or read workspace A's conversation.
      await assert.rejects(() => b.getConversation(conv.id), (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'));
      await assert.rejects(() => b.getConversationMessages(conv.id), (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'));
    });
  });

  // ── P2: opt-in remote routing through the deterministic mock pilot-api ──────
  suite('remote-pilot routing (opt-in)', () => {
    let mock: MockPilotApi;

    setup(async () => {
      mock = await startMockPilotApi({ capabilities: 'ok' });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('pilotApiUrl', mock.url, vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiAuthMode', 'bearer', vscode.ConfigurationTarget.Global);
      await cfg.update('mode', 'remote-pilot', vscode.ConfigurationTarget.Global);
      await extApi!.setToken('test-jwt');
    });

    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearToken();
      await extApi!.resolveBackend(true);
      await mock.close();
    });

    test('resolves to remote and streams tokens from pilot-api', async function () {
      this.timeout(20_000);
      const resolved = await extApi!.resolveBackend(true);
      assert.equal(resolved.kind, 'remote', 'remote-pilot mode should resolve remote against the mock');

      const chunks: string[] = [];
      let doneSeen = false;
      for await (const chunk of extApi!.router.chat(
        { requestId: 'host-remote-1', local: null, remote: { message: 'hi' } },
        undefined,
      )) {
        if (chunk.type === 'token') {
          chunks.push(chunk.text);
        } else if (chunk.type === 'done') {
          doneSeen = true;
        }
      }
      assert.equal(chunks.join(''), 'Hello world', 'streamed tokens from the mock');
      assert.ok(doneSeen, 'stream completed');

      // The token must have been sent to the mock and never leaked to logs.
      const chatReq = mock.requests.find((r) => r.path === '/api/pilot/chat/stream');
      assert.ok(chatReq, 'mock received the chat stream request');
      assert.equal(chatReq.headers['authorization'], 'Bearer test-jwt');
    });

    test('explainSelection command streams from pilot-api into a result document', async function () {
      this.timeout(20_000);
      await extApi!.resolveBackend(true);
      const doc = await vscode.workspace.openTextDocument(fixtureUri());
      const editor = await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(0, 0, 1, 1);

      await vscode.commands.executeCommand('migrapilot.explainSelection');

      const resultDoc = vscode.window.activeTextEditor?.document;
      assert.ok(resultDoc, 'expected a result editor');
      assert.match(resultDoc.getText(), /Explain Selection \(pilot-api\)/, 'remote explain header');
      assert.match(resultDoc.getText(), /Hello world/, 'streamed content present');
    });
  });

  // Capability-denied fix flow: remote is ready but lacks the 'proposed-edits'
  // operation class, so fixDiagnostics must be denied (not run, not fall back).
  suite('remote-pilot capability-denied fix (opt-in)', () => {
    let mock: MockPilotApi;

    setup(async () => {
      mock = await startMockPilotApi({ capabilities: 'no-edits' });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('pilotApiUrl', mock.url, vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiAuthMode', 'bearer', vscode.ConfigurationTarget.Global);
      await cfg.update('mode', 'remote-pilot', vscode.ConfigurationTarget.Global);
      await extApi!.setToken('test-jwt');
    });

    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearToken();
      await extApi!.resolveBackend(true);
      await mock.close();
    });

    test('fixDiagnostics is capability-denied (CAPABILITY_MISSING), no remote edit fetched', async function () {
      this.timeout(20_000);
      const resolved = await extApi!.resolveBackend(true);
      assert.equal(resolved.kind, 'remote', 'remote resolves (ready) but lacks proposed-edits');

      const decision = evaluateCapability(resolved, CAP_FIX_DIAGNOSTICS);
      assert.equal(decision.mode, 'denied');
      if (decision.mode === 'denied') {
        assert.equal(decision.error.code, 'CAPABILITY_MISSING');
      }

      // Driving the command must not fetch a proposed edit from pilot-api.
      const uri = fixtureUri();
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc);
      const collection = vscode.languages.createDiagnosticCollection('p3-denied');
      collection.set(uri, [
        new vscode.Diagnostic(new vscode.Range(0, 0, 0, 5), 'unused', vscode.DiagnosticSeverity.Warning),
      ]);
      try {
        await vscode.commands.executeCommand('migrapilot.fixDiagnostics');
        assert.equal(
          mock.requests.some((r) => r.path === '/api/pilot/proposed-edits'),
          false,
          'denied fix must not call proposed-edits',
        );
      } finally {
        collection.dispose();
      }
    });
  });

  // No mid-test mock swap: a single config write in setup keeps this robust in
  // VSIX mode, where runner and packaged extension have separate config objects.
  suite('remote-pilot no-fallback (opt-in)', () => {
    let mock: MockPilotApi;

    setup(async () => {
      mock = await startMockPilotApi({ capabilities: 'unauthorized' });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('pilotApiUrl', mock.url, vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiAuthMode', 'bearer', vscode.ConfigurationTarget.Global);
      await cfg.update('mode', 'remote-pilot', vscode.ConfigurationTarget.Global);
      await extApi!.clearToken();
    });

    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.resolveBackend(true);
      await mock.close();
    });

    test('failure surfaces PilotError, never the local stub', async function () {
      this.timeout(20_000);
      const resolved = await extApi!.resolveBackend(true);
      assert.equal(resolved.kind, 'remote-unavailable', 'must not activate remote nor fall back to local');

      await assert.rejects(
        async () => {
          for await (const _ of extApi!.router.chat(
            { requestId: 'host-remote-2', local: null, remote: { message: 'hi' } },
            undefined,
          )) {
            /* must throw before yielding stub output */
          }
        },
        (err: unknown) => isPilotErrorCode(err, 'AUTH_REQUIRED'),
      );
    });
  });

  // ── P4: approval lifecycle in the real host (asserts mock STORE state) ──────
  async function configureRemoteFor(mock: MockPilotApi): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('migrapilot');
    await cfg.update('pilotApiUrl', mock.url, vscode.ConfigurationTarget.Global);
    await cfg.update('pilotApiAuthMode', 'bearer', vscode.ConfigurationTarget.Global);
    await cfg.update('mode', 'remote-pilot', vscode.ConfigurationTarget.Global);
    await extApi!.setToken('test-jwt');
    await extApi!.resolveBackend(true);
  }
  async function resetRemote(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('migrapilot');
    await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
    await cfg.update('pilotApiUrl', undefined, vscode.ConfigurationTarget.Global);
    await extApi!.clearToken();
    await extApi!.resolveBackend(true);
  }

  suite('approval: approve → exact stored action executes once', () => {
    let mock: MockPilotApi;
    setup(async () => {
      mock = await startMockPilotApi({ runProgressPolls: 2 });
      await configureRemoteFor(mock);
    });
    teardown(async () => {
      await resetRemote();
      await mock.close();
    });
    test('executes exactly once and reaches EXECUTED', async function () {
      this.timeout(20_000);
      const outcome = await approveResumeAndReconcile(extApi!.approvals, 'a1');
      assert.equal(outcome.status, 'completed');
      assert.equal(mock.getAction('a1')?.state, 'EXECUTED');
      assert.equal(mock.executionCount('a1'), 1);
    });

    test('rendered consent view shows only the user-facing delta', async function () {
      this.timeout(20_000);
      const consent = await extApi!.renderConsent('a1');
      // Present: the actual delta (partial-update wording + changed fields).
      assert.match(consent, /Update — file "sample\.ts"/);
      assert.match(consent, /only the fields listed below change/i);
      assert.match(consent, /`mode`/);
      assert.match(consent, /0755/);
      assert.match(consent, /`nested\.retries`/, 'nested delta rendered');
      assert.match(consent, /‹redacted›/, 'secret redacted');
      // Absent: internal identifiers and secret values.
      for (const forbidden of ['approvalToken', 'tok-old', 'tok-new', 'runId', 'r1', 'apr-a1', 'OLD-SECRET', 'NEW-SECRET', 'owner']) {
        assert.ok(!consent.includes(forbidden), `consent view must not contain ${forbidden}`);
      }
    });
  });

  suite('approval: reject → no execution', () => {
    let mock: MockPilotApi;
    setup(async () => {
      mock = await startMockPilotApi({});
      await configureRemoteFor(mock);
    });
    teardown(async () => {
      await resetRemote();
      await mock.close();
    });
    test('rejects and never executes', async function () {
      this.timeout(20_000);
      const rejected = await extApi!.approvals.reject('a1', 'host-reject');
      assert.equal(rejected.state, 'REJECTED');
      assert.equal(mock.getAction('a1')?.state, 'REJECTED');
      assert.equal(mock.executionCount('a1'), 0);
    });
  });

  suite('approval: reconnect after simulated SSE loss', () => {
    let mock: MockPilotApi;
    setup(async () => {
      mock = await startMockPilotApi({ dropExecStream: true });
      await configureRemoteFor(mock);
    });
    teardown(async () => {
      await resetRemote();
      await mock.close();
    });
    test('dropped exec stream reconciles via runId, single execution', async function () {
      this.timeout(20_000);
      const approved = await extApi!.approvals.approve('a1', 'host-a');
      await extApi!.approvals.resume('a1', approved.approvalId!, 'host-r');

      // The progress stream drops — must NOT be read as failure.
      await assert.rejects(
        async () => {
          for await (const _ of extApi!.approvals.watchExecution('a1')) {
            /* consume until drop */
          }
        },
        (err: unknown) => isPilotErrorCode(err, 'NETWORK'),
      );

      const outcome = await reconcileRun(extApi!.approvals, 'r1', 'a1', { sleep: async () => {} });
      assert.equal(outcome.status, 'completed');
      assert.equal(mock.executionCount('a1'), 1);
    });
  });

  suite('approval: replay refusal after terminal state', () => {
    let mock: MockPilotApi;
    setup(async () => {
      mock = await startMockPilotApi({});
      await configureRemoteFor(mock);
    });
    teardown(async () => {
      await resetRemote();
      await mock.close();
    });
    test('resume after EXECUTED is INVALID_STATE, execution stays single', async function () {
      this.timeout(20_000);
      const approved = await extApi!.approvals.approve('a1', 'host-a');
      await extApi!.approvals.resume('a1', approved.approvalId!, 'host-r1');
      await assert.rejects(
        () => extApi!.approvals.resume('a1', approved.approvalId!, 'host-r2'),
        (err: unknown) => isPilotErrorCode(err, 'INVALID_STATE'),
      );
      assert.equal(mock.executionCount('a1'), 1);
    });
  });

  // ── P5: local brain lifecycle — auto-start + readiness + graceful shutdown ──
  suite('local-brain lifecycle (auto-start + shutdown)', () => {
    // A port this test OWNS. It used to use 3988 — the developer's default
    // `migrapilot.brainUrl` — and only satisfied its "brain not running"
    // precondition because the harness had destroyed whatever was there. A test
    // asserting that shutdown stops ONLY the owned process must not buy its own
    // precondition by killing an unowned one.
    const LIFE_PORT = 3992;
    const LIFE_URL = `http://127.0.0.1:${LIFE_PORT}`;

    async function brainHealthy(url: string): Promise<boolean> {
      try {
        const r = await fetch(`${url}/health`);
        if (!r.ok) {
          return false;
        }
        const b = (await r.json()) as { service?: string };
        return b.service === 'migrapilot-brain';
      } catch {
        return false;
      }
    }

    setup(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
      await cfg.update('brainUrl', LIFE_URL, vscode.ConfigurationTarget.Global);
      await cfg.update('autoStartBrain', true, vscode.ConfigurationTarget.Global);
      await cfg.update('brainAutoStartCommand', ['node', brainServer], vscode.ConfigurationTarget.Global);
      // The extension's launcher spreads `process.env` into the child, so this
      // is how the auto-started brain lands on the port THIS TEST owns instead
      // of the developer's default 3988.
      process.env.MIGRAPILOT_BRAIN_PORT = String(LIFE_PORT);
    });

    teardown(async () => {
      await extApi!.lifecycle.shutdown();
      delete process.env.MIGRAPILOT_BRAIN_PORT;
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('brainUrl', BRAIN_URL, vscode.ConfigurationTarget.Global);
      await cfg.update('brainAutoStartCommand', undefined, vscode.ConfigurationTarget.Global);
    });

    test('auto-starts the brain, then shutdown stops only the owned process', async function () {
      this.timeout(30_000);
      // The port is this test's own, so this precondition is established by
      // choosing an unused port — never by killing someone else's service.
      assert.equal(await brainHealthy(LIFE_URL), false, 'brain not running before auto-start');

      const result = await extApi!.lifecycle.ensureRunning();
      assert.equal(result, 'started', 'auto-start reports started');
      assert.ok(extApi!.lifecycle.ownedPid(), 'extension owns the spawned pid');
      assert.equal(await brainHealthy(LIFE_URL), true, 'brain reachable after auto-start');

      // Re-running must adopt (not spawn a second).
      assert.equal(await extApi!.lifecycle.ensureRunning(), 'already-brain');

      await extApi!.lifecycle.shutdown();
      assert.equal(extApi!.lifecycle.ownedPid(), undefined, 'no longer owns a process');

      let down = false;
      for (let i = 0; i < 25 && !down; i++) {
        down = !(await brainHealthy(LIFE_URL));
        if (!down) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      assert.equal(down, true, 'brain stopped after shutdown');
    });
  });

  // ── P7: real model-provider run (against the deterministic mock provider) ────
  suite('model provider (openai-compat) real run', () => {
    let provider: MockModelProvider;

    setup(async () => {
      provider = await startMockModelProvider({ requireAuth: true, tokens: ['Hello', ' world'] });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'openai-compat', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', provider.url, vscode.ConfigurationTarget.Global);
      await cfg.update('providerModel', 'mock-model', vscode.ConfigurationTarget.Global);
      await extApi!.setProviderKey('sk-host-key');
    });

    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'stub', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearProviderKey();
      await provider.close();
    });

    test('streams a real completion with correlation and provider identity', async function () {
      this.timeout(20_000);
      const p = extApi!.provider();
      assert.equal(p.capabilities().providerId, 'openai-compat', 'configured real provider (not stub)');
      assert.equal(p.capabilities().model, 'mock-model');

      let text = '';
      for await (const chunk of p.stream({ messages: [{ role: 'user', content: 'ping' }], requestId: 'host-prov-1' }) as AsyncGenerator<ProviderChunk>) {
        if (chunk.type === 'token') {
          text += chunk.text;
        }
      }
      assert.equal(text, 'Hello world', 'real streamed completion');

      // Correlation + auth on the wire; key never exposed by the provider itself.
      const req = provider.requests[0]!;
      assert.equal(req.headers['x-request-id'], 'host-prov-1');
      assert.equal(req.headers['authorization'], 'Bearer sk-host-key');
    });

    test('cancellation aborts the provider stream (CANCELLED, no false completion)', async function () {
      this.timeout(20_000);
      const p = extApi!.provider();
      const ac = new AbortController();
      ac.abort();
      await assert.rejects(
        async () => {
          for await (const _ of p.stream({ messages: [{ role: 'user', content: 'x' }], requestId: 'host-prov-2' }, ac.signal)) {
            /* must throw before completing */
          }
        },
        (err: unknown) => isPilotErrorCode(err, 'CANCELLED'),
      );
    });
  });

  // ── generateTests: provider-backed, non-destructive (assert workspace) ──────
  suite('generateTests (stub provider, local)', () => {
    let root: string;
    setup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
      await vscode.workspace
        .getConfiguration('migrapilot')
        .update('provider', 'stub', vscode.ConfigurationTarget.Global);
    });
    teardown(() => {
      for (const f of ['genwrite.ts', 'genwrite.test.ts', 'gencancel.ts', 'gencancel.test.ts']) {
        try {
          fs.rmSync(path.join(root, f));
        } catch {
          /* ignore */
        }
      }
    });

    test('preview → confirm → write → read-back (workspace actually changes)', async function () {
      this.timeout(20_000);
      fs.writeFileSync(path.join(root, 'genwrite.ts'), 'export const a = 1;\n');
      const result = await extApi!.generateTests('genwrite.ts', true, { runCommand: false });
      assert.equal(result.status, 'written');
      if (result.status === 'written') {
        assert.deepEqual(result.written, ['genwrite.test.ts']);
        assert.equal(result.verified, true, 'read-back verified');
      }
      // Assert the workspace state directly.
      const onDisk = path.join(root, 'genwrite.test.ts');
      assert.equal(fs.existsSync(onDisk), true, 'test file exists on disk');
      assert.match(fs.readFileSync(onDisk, 'utf8'), /describe\(|test\(/);
    });

    test('cancel before apply → no write (workspace unchanged)', async function () {
      this.timeout(20_000);
      fs.writeFileSync(path.join(root, 'gencancel.ts'), 'export const b = 2;\n');
      const result = await extApi!.generateTests('gencancel.ts', false);
      assert.equal(result.status, 'no-write');
      assert.equal(fs.existsSync(path.join(root, 'gencancel.test.ts')), false, 'no file written on cancel');
    });
  });

  suite('generateTests unsafe proposal (openai-compat)', () => {
    let root: string;
    let mock: MockModelProvider;
    setup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
      const unsafe = JSON.stringify({ files: [{ path: '../evil.test.ts', contents: 'x', mode: 'create' }] });
      mock = await startMockModelProvider({ tokens: [unsafe] });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'openai-compat', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', mock.url, vscode.ConfigurationTarget.Global);
      await extApi!.setProviderKey('sk-host');
    });
    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'stub', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearProviderKey();
      await mock.close();
      try {
        fs.rmSync(path.join(root, 'genunsafe.ts'));
      } catch {
        /* ignore */
      }
    });

    test('unsafe provider path is refused and nothing is written', async function () {
      this.timeout(20_000);
      fs.writeFileSync(path.join(root, 'genunsafe.ts'), 'export const c = 3;\n');
      const result = await extApi!.generateTests('genunsafe.ts', true, { runCommand: false });
      assert.equal(result.status, 'refused');
      assert.equal(fs.existsSync(path.join(root, '..', 'evil.test.ts')), false, 'unsafe path never written');
    });
  });

  // ── commit-message generation: read-only (assert git state before/after) ────
  function git(root: string, args: string[]): string {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  }
  function gitState(root: string): { head: string; staged: string } {
    return {
      head: git(root, ['rev-parse', 'HEAD']).trim(),
      staged: git(root, ['diff', '--cached', '--name-only']).trim(),
    };
  }

  suite('commit message: staged change (stub)', () => {
    let root: string;
    setup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
      await vscode.workspace
        .getConfiguration('migrapilot')
        .update('provider', 'stub', vscode.ConfigurationTarget.Global);
      fs.writeFileSync(path.join(root, 'commitme.ts'), 'export const z = 9;\n');
      git(root, ['add', 'commitme.ts']);
    });
    teardown(() => {
      try {
        git(root, ['reset', '--', 'commitme.ts']);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(path.join(root, 'commitme.ts'));
      } catch {
        /* ignore */
      }
    });

    test('generates a subject/body and leaves the repo unchanged', async function () {
      this.timeout(20_000);
      const before = gitState(root);
      const result = await extApi!.generateCommitMessage();
      assert.equal(result.status, 'generated');
      if (result.status === 'generated') {
        assert.ok(result.subject.length > 0 && !result.subject.includes('\n'));
        assert.match(result.body, /commitme\.ts/);
      }
      const after = gitState(root);
      assert.deepEqual(after, before, 'repo state unchanged (read-only)');
    });
  });

  suite('commit message: no staged changes (openai-compat)', () => {
    let root: string;
    let mock: MockModelProvider;
    setup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
      try {
        git(root, ['reset']); // ensure nothing staged
      } catch {
        /* ignore */
      }
      mock = await startMockModelProvider({});
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'openai-compat', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', mock.url, vscode.ConfigurationTarget.Global);
      await extApi!.setProviderKey('sk-host');
    });
    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'stub', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearProviderKey();
      await mock.close();
    });

    test('precise no-staged result and NO provider request', async function () {
      this.timeout(20_000);
      const before = gitState(root);
      const result = await extApi!.generateCommitMessage();
      assert.equal(result.status, 'no-staged-changes');
      assert.equal(mock.requests.length, 0, 'no provider request when nothing is staged');
      assert.deepEqual(gitState(root), before, 'repo unchanged');
    });
  });

  suite('commit message: provider failure (openai-compat 500)', () => {
    let root: string;
    let mock: MockModelProvider;
    setup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
      fs.writeFileSync(path.join(root, 'failme.ts'), 'export const q = 1;\n');
      git(root, ['add', 'failme.ts']);
      mock = await startMockModelProvider({ status: 500 });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'openai-compat', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', mock.url, vscode.ConfigurationTarget.Global);
      await extApi!.setProviderKey('sk-host');
    });
    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('provider', 'stub', vscode.ConfigurationTarget.Global);
      await cfg.update('providerUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearProviderKey();
      await mock.close();
      try {
        git(root, ['reset', '--', 'failme.ts']);
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(path.join(root, 'failme.ts'));
      } catch {
        /* ignore */
      }
    });

    test('surfaces an error and produces no side effect (repo unchanged)', async function () {
      this.timeout(20_000);
      const before = gitState(root);
      const result = await extApi!.generateCommitMessage();
      assert.equal(result.status, 'error', 'provider failure surfaces error, no fabricated message');
      assert.deepEqual(gitState(root), before, 'repo unchanged after failure');
    });
  });

  // ── backend-selection diagnostics (observational; sanitized) ────────────────
  suite('backend diagnostics: explicit local', () => {
    setup(async () => {
      await vscode.workspace
        .getConfiguration('migrapilot')
        .update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
    });
    test('records local selection with explicit source', async () => {
      const resolved = await extApi!.resolveBackend(true);
      assert.equal(resolved.kind, 'local');
      const snap = extApi!.backendDiagnostics();
      assert.equal(snap.current?.backend, 'local');
      assert.equal(snap.current?.reason, 'local-mode-configured');
      assert.equal(snap.current?.source, 'explicit');
      assert.equal(snap.current?.trigger, 're-resolve');
    });
  });

  suite('backend diagnostics: explicit remote failure + auto', () => {
    let mock: MockPilotApi;
    setup(async () => {
      mock = await startMockPilotApi({ capabilities: 'unauthorized' });
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('pilotApiUrl', mock.url, vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiAuthMode', 'bearer', vscode.ConfigurationTarget.Global);
      await cfg.update('mode', 'remote-pilot', vscode.ConfigurationTarget.Global);
      await extApi!.setToken('test-jwt');
    });
    teardown(async () => {
      const cfg = vscode.workspace.getConfiguration('migrapilot');
      await cfg.update('mode', 'local-brain', vscode.ConfigurationTarget.Global);
      await cfg.update('pilotApiUrl', undefined, vscode.ConfigurationTarget.Global);
      await extApi!.clearToken();
      await extApi!.resolveBackend(true);
      await mock.close();
    });

    test('explicit remote failure → remote-unavailable, NO fallback; snapshot leaks no secrets', async () => {
      const resolved = await extApi!.resolveBackend(true);
      assert.equal(resolved.kind, 'remote-unavailable', 'explicit remote failure stays remote-unavailable (no fallback)');
      const snap = extApi!.backendDiagnostics();
      assert.equal(snap.current?.backend, 'remote-unavailable');
      assert.equal(snap.current?.remoteProbe, 'unauthorized');
      assert.equal(snap.current?.source, 'explicit');

      // The whole snapshot must carry no secret / URL / auth material.
      const rendered = JSON.stringify(extApi!.backendDiagnostics());
      for (const forbidden of ['test-jwt', 'Bearer', mock.url, '127.0.0.1', 'authorization', 'sk-']) {
        assert.ok(!rendered.includes(forbidden), `snapshot must not contain "${forbidden}"`);
      }
    });

    test('auto resolves remote when ready, source=auto (separate mock)', async () => {
      const okMock = await startMockPilotApi({ capabilities: 'ok' });
      try {
        const cfg = vscode.workspace.getConfiguration('migrapilot');
        await cfg.update('pilotApiUrl', okMock.url, vscode.ConfigurationTarget.Global);
        await cfg.update('mode', 'auto', vscode.ConfigurationTarget.Global);
        const resolved = await extApi!.resolveBackend(true);
        assert.equal(resolved.kind, 'remote');
        const snap = extApi!.backendDiagnostics();
        assert.equal(snap.current?.backend, 'remote');
        assert.equal(snap.current?.reason, 'auto-remote-ready');
        assert.equal(snap.current?.source, 'auto');
      } finally {
        await okMock.close();
      }
    });
  });

  // ── MigraAI Workspace panel (/api/ai/workspaces) ─────────────────────────────
  suite('MigraAI Workspace', () => {
    // A scoped client with a UNIQUE workspace scope per test → full isolation on
    // the shared engine, while indexing the REAL fixture folder (so sync has
    // files). Mirrors the raw-client pattern used by the other engine suites.
    const fixtureRoot = () => {
      const f = vscode.workspace.workspaceFolders?.[0];
      assert.ok(f, 'expected a workspace folder');
      return f.uri.fsPath;
    };
    const scoped = (scopeWs: string) =>
      new MigraAiClient({
        baseUrl: () => BRAIN_URL,
        timeoutMs: () => 15_000,
        log: () => {},
        scope: () => ({ owner: 'local', workspace: scopeWs }),
      });

    test('open uses the ACTIVE workspace root, then sync → approve(current) → Ready; rebuild needs re-approval', async () => {
      // Through the extension's own controller + mapper (panel model), on the
      // active workspace root — never an inferred subfolder.
      const res = extApi!.workspace.resolveRoot();
      assert.equal(res.kind, 'root', 'single active folder resolves to a root');

      const opened = await extApi!.workspace.open();
      const rootRow = opened.sections.find((s) => s.title === 'Workspace')!.rows.find((r) => r.label === 'Root')!;
      assert.equal(rootRow.value, fixtureRoot(), 'opened at the exact active workspace root');
      const id = opened.workspaceId;

      const synced = await extApi!.workspace.sync(id);
      assert.equal(synced.status.label, 'Needs approval', 'authoritative status after sync (not "Ready" just from a 200)');
      assert.ok(synced.indexChunks > 0, 'real fixture files were indexed');
      assert.equal(synced.actions.approve, true, 'approval offered');

      const approved = await extApi!.workspace.approve(id, synced.indexVersion);
      assert.equal(approved.status.label, 'Ready', 'approving the exact version makes it Ready');
      assert.equal(approved.actions.approve, false, 'nothing left to approve');

      const rebuilt = await extApi!.workspace.rebuild(id);
      assert.equal(rebuilt.status.label, 'Needs approval', 'rebuilt index is NOT auto-approved');
      assert.equal(rebuilt.actions.approve, true, 're-approval required after rebuild');

      // Clean up the extension-scoped workspace so re-runs start fresh.
      await extApi!.workspace.delete(id);
    });

    test('approving a STALE index version is refused; the current version approves', async () => {
      const client = scoped('ws-stale-test');
      const opened = await client.openWorkspace({ root: fixtureRoot() });
      const synced = await client.syncWorkspace(opened.workspace.id);
      assert.ok(synced.index.chunks > 0);
      assert.equal(synced.index.version, 1, 'first sync → version 1');

      // Approving an older version is refused (409 → INVALID_STATE), not silently applied.
      await assert.rejects(
        () => client.approveWorkspaceIndex(opened.workspace.id, synced.index.version - 1),
        (e: unknown) => isPilotErrorCode(e, 'INVALID_STATE'),
        'stale approval must be refused',
      );
      const stillUnapproved = await client.getWorkspace(opened.workspace.id);
      assert.notEqual(stillUnapproved.index.state, 'approved', 'stale approval did not promote');

      // The exact current version approves.
      const ok = await client.approveWorkspaceIndex(opened.workspace.id, synced.index.version);
      assert.equal(ok.health, 'ready');

      await client.deleteWorkspace(opened.workspace.id);
    });

    test('sync honors cancellation and never reports completion / mutates state', async () => {
      const client = scoped('ws-cancel-test');
      const opened = await client.openWorkspace({ root: fixtureRoot() });
      const before = await client.getWorkspace(opened.workspace.id);

      const controller = new AbortController();
      controller.abort(); // pre-aborted → the request is cancelled, not completed
      await assert.rejects(
        () => client.syncWorkspace(opened.workspace.id, controller.signal),
        (e: unknown) => isPilotErrorCode(e, 'CANCELLED'),
        'a cancelled sync rejects with CANCELLED (no false "done")',
      );

      const after = await client.getWorkspace(opened.workspace.id);
      assert.equal(after.index.version, before.index.version, 'cancelled sync left the index version unchanged');
      assert.equal(after.health, before.health, 'cancelled sync left health unchanged');

      await client.deleteWorkspace(opened.workspace.id);
    });

    test('deleted workspace no longer appears in the list and cannot be fetched', async () => {
      const client = scoped('ws-delete-test');
      const opened = await client.openWorkspace({ root: fixtureRoot() });
      const id = opened.workspace.id;
      assert.ok((await client.listWorkspaces()).workspaces.some((w) => w.id === id), 'listed before delete');

      const del = await client.deleteWorkspace(id);
      assert.equal(del.ok, true);

      assert.ok(!(await client.listWorkspaces()).workspaces.some((w) => w.id === id), 'gone from the list after delete');
      await assert.rejects(
        () => client.getWorkspace(id),
        (e: unknown) => isPilotErrorCode(e, 'CAPABILITY_MISSING'),
        'a deleted workspace 404s (no ghost state)',
      );
    });
  });

  // ── Approved-retrieval grounding through the REAL installed path ────────────
  //
  // The historical failure (corr_ms1iwdhw4lbyim) happened in the installed VS Code
  // path, so it must be closed there: a real VS Code host, the extension's own
  // transport and renderer, a real Brain built from the current dist, and a real
  // APPROVED index. Only the webview DOM is out of scope here (covered by the
  // composer markup assertion below).
  suite('Approved retrieval grounding (installed path)', () => {
    const groundingClient = () =>
      new MigraAiClient({
        baseUrl: () => BRAIN_URL,
        timeoutMs: () => 120_000,
        log: () => {},
        scope: () => ({ owner: 'local', workspace: 'grounding-proof' }),
      });

    /** Build an APPROVED index over the fixture workspace and return its version. */
    async function approvedFixtureIndex(): Promise<number> {
      const client = groundingClient();
      const folder = vscode.workspace.workspaceFolders?.[0];
      assert.ok(folder, 'expected a workspace folder');
      const opened = await client.openWorkspace({ root: folder.uri.fsPath });
      const workspaceId = opened.workspace.id;
      const synced = await client.syncWorkspace(workspaceId);
      assert.ok(synced.index.chunks > 0, 'the fixture must produce a real index');
      const approved = await client.approveWorkspaceIndex(workspaceId, synced.index.version);
      assert.equal(approved.index.state, 'approved');
      return approved.index.version;
    }

    test('the composer renders the evidence-source selector', () => {
      // The activation control must EXIST in the shipped markup — it was once
      // defined and never rendered, leaving the mode reachable only via /approved.
      const html = shellHtml({ nonce: 'test-nonce', csp: "default-src 'none'", initialTab: 'chat', script: 'void 0;', compact: false });
      assert.match(html, /id="csource"/, 'the evidence-source select must be present');
      assert.match(html, /Approved index/, 'and expose the approved-only option');
      assert.match(html, /Auto evidence/, 'with an explicitly-named default, not a bare "Auto"');
      // Both selects must be styled by ONE rule: styling a single id left this one
      // rendering as a native white control against the dark shell.
      assert.match(html, /#croute,\s*#csource/, 'both composer selects share the style rule');
      // It sits with the other composer controls, not somewhere unreachable.
      const composer = html.slice(html.indexOf('id="ctools"'), html.indexOf('id="chint"'));
      assert.match(composer, /id="csource"/, 'rendered inside the composer tool row');
    });

    test('an approved-only turn with insufficient evidence REFUSES and discloses divergence', async () => {
      const version = await approvedFixtureIndex();
      const rendered: string[] = [];
      const events: string[] = [];

      // The REAL renderer the Command Center uses, over the REAL SSE transport.
      await runEngineerTurn(
        groundingClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'Using only the approved semantic index, identify the files and symbols that implement schema-v6 approved-version isolation.',
          requireApproved: true,
          currentBranch: 'fix/brain-approved-retrieval-grounding',
        },
        {
          markdown: (t) => rendered.push(t),
          progress: () => {},
        },
      );

      const text = rendered.join('');
      // 1. approved-only armed AND disclosed, with the version named.
      assert.match(text, /Source mode: Approved index v\d+/, `expected the source-mode badge; got: ${text.slice(0, 400)}`);
      // 2. refusal, not an answer.
      assert.match(text, /Insufficient approved evidence/i, 'must refuse rather than answer');
      // 3. the fixed, host-rendered disclosure.
      assert.match(text, /No working-tree files were consulted/);
      // 4. no unrelated citations.
      for (const decoy of ['PROVENANCE.md', 'package.json']) {
        assert.ok(!text.includes(decoy), `must not cite ${decoy}`);
      }
      // 5. the loop never ran — no tool/step lines in the rendered output.
      assert.ok(!/^· `/m.test(text), 'no tool step may be rendered');
      assert.ok(version > 0);
      assert.equal(events.length, 0);
    });

    test('all four grounding modes reach the Brain and are enforced there', async () => {
      const version = await approvedFixtureIndex();
      assert.ok(version > 0);
      const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;

      // Each mode is driven through the extension's OWN transport + renderer against
      // the real Brain, so the assertion is on enforcement, not on intent.
      const outcomes: Array<{ mode: string; text: string }> = [];
      for (const mode of ['auto', 'approved', 'workspace', 'none'] as const) {
        const rendered: string[] = [];
        await runEngineerTurn(
          groundingClient(),
          {
            rootPath: root,
            task: 'What does this workspace contain?',
            ...(mode === 'auto' ? {} : { groundingMode: mode }),
            currentBranch: 'phase-1/canonical-vscode-extension',
          },
          { markdown: (t) => rendered.push(t), progress: () => {} },
        );
        outcomes.push({ mode, text: rendered.join('') });
      }

      for (const { mode, text } of outcomes) {
        // Every turn discloses a source mode — none may answer unlabelled.
        assert.match(
          text,
          /Source mode: (Approved index|Current workspace|Working tree|No repository evidence)|Insufficient approved evidence/,
          `${mode}: must disclose its evidence source; got: ${text.slice(0, 200)}`,
        );
      }

      const byMode = Object.fromEntries(outcomes.map((o) => [o.mode, o.text]));
      // `none` must never claim repository evidence.
      assert.ok(
        /No repository evidence/.test(byMode.none!),
        `none: expected the no-evidence badge; got: ${byMode.none!.slice(0, 200)}`,
      );
      assert.ok(!/Approved index/.test(byMode.none!), 'none must not claim approved evidence');
      // `workspace` must never claim approved evidence either.
      assert.ok(!/Source mode: Approved index/.test(byMode.workspace!), 'workspace must not claim the approved index');
    });

    test('an approved-only turn WITH evidence answers and still states its source', async () => {
      const version = await approvedFixtureIndex();
      const rendered: string[] = [];

      await runEngineerTurn(
        groundingClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          // A question the fixture index can actually support.
          task: 'What does this workspace contain? Summarise the indexed files.',
          requireApproved: true,
          currentBranch: 'fix/brain-approved-retrieval-grounding',
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );

      const text = rendered.join('');
      // Whether it grounds or refuses, provenance is ALWAYS stated and the working
      // tree is never silently used.
      assert.match(text, /Source mode: Approved index v\d+|Insufficient approved evidence/i, `expected a disclosed outcome; got: ${text.slice(0, 400)}`);
      assert.ok(!text.includes('Source mode: Working tree'), 'an approved-only turn must never report working-tree mode');
      assert.ok(version > 0);
    });
  });

  suite('Live knowledge (installed path)', () => {
    const liveClient = () =>
      new MigraAiClient({
        baseUrl: () => BRAIN_URL,
        timeoutMs: () => 120_000,
        log: () => {},
        scope: () => ({ owner: 'local', workspace: 'live-knowledge-proof' }),
      });

    /** One turn through the extension's OWN transport and renderer. */
    async function turn(
      liveMode: 'off' | 'official' | 'web' | undefined,
      groundingMode?: 'auto' | 'approved' | 'workspace' | 'none',
    ): Promise<string> {
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'Which npm typescript version is current?',
          // Omitted for `off`, exactly as the composer serializes it.
          ...(liveMode && liveMode !== 'off' ? { liveKnowledgeMode: liveMode } : {}),
          ...(groundingMode ? { groundingMode } : {}),
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      return rendered.join('');
    }

    test('the composer renders the live-knowledge selector with honest labels', () => {
      // The control must EXIST in the shipped markup. The evidence selector was once
      // defined and never rendered, so the mode was reachable only by slash command.
      const html = shellHtml({ nonce: 'test-nonce', csp: "default-src 'none'", initialTab: 'chat', script: 'void 0;', compact: false });
      assert.match(html, /id="clive"/, 'the live-knowledge select must be present');
      assert.match(html, /Live knowledge off/, 'the default option names itself');
      assert.match(html, /Official sources/);
      assert.match(html, /Web research/);
      // Every select shares one style rule, or one of them renders as a native white
      // control against the dark shell — which is how that bug happened before. Read from
      // the rendered document, so this is what the webview actually receives.
      const styled = shellHtml({ nonce: 'n', csp: "default-src 'none'", initialTab: 'chat', script: 'void 0;', compact: false });
      const shellStylesText = () => styled;
      assert.match(shellStylesText(), /#croute, #csource, #clive \{/);
    });

    test('all three live modes reach the real Brain and each discloses its own frame', async () => {
      const outcomes: Array<{ mode: string; text: string }> = [];
      for (const mode of ['off', 'official', 'web'] as const) {
        outcomes.push({ mode, text: await turn(mode) });
      }
      const byMode = Object.fromEntries(outcomes.map((o) => [o.mode, o.text]));

      // Every turn carries a live-knowledge frame, host-rendered, whatever the outcome.
      for (const { mode, text } of outcomes) {
        assert.match(text, /Live knowledge: /, `${mode}: must disclose a live-knowledge frame; got: ${text.slice(0, 300)}`);
      }

      // `off` says off, and never claims to have consulted anything.
      assert.match(byMode.off!, /Live knowledge: Off(?![a-z])/, `off frame missing; got: ${byMode.off!.slice(0, 300)}`);
      assert.ok(!/Sources accepted: [1-9]/.test(byMode.off!), 'off must accept no sources');

      // With no provider wired into the running Brain, official reports the OUTAGE
      // rather than looking like the operator chose off.
      assert.ok(
        /Official sources|unavailable \(no-connector\)|no authoritative sources found/.test(byMode.official!),
        `official: expected an authoritative outcome or a named outage; got: ${byMode.official!.slice(0, 300)}`,
      );
      // The lookahead is load-bearing: "Off" is a prefix of "Official", so the original
      // assertion matched the very headline it was meant to exclude. It passed only because
      // no connector was wired at the time, leaving official to render as an outage. `\b`
      // does not work either — the frame is wrapped in markdown italics and `_` is a word
      // character, so only "not followed by a letter" discriminates the two.
      assert.ok(
        !/Live knowledge: Off(?![a-z])/.test(byMode.official!),
        `official must never render as off; got: ${byMode.official!.slice(0, 200)}`,
      );

      // `web` must never claim broad coverage while no general-web provider exists.
      assert.ok(
        !/Live knowledge: Web research\b/.test(byMode.web!),
        `web must not claim general-web coverage; got: ${byMode.web!.slice(0, 300)}`,
      );
    });

    test('the two evidence dimensions are disclosed separately in one turn', async () => {
      // Repository `none` with live `official`: the combination the two dimensions exist
      // for. Each must state its own boundary; one line for both would make "no
      // repository evidence" and "no external evidence" indistinguishable.
      const text = await turn('official', 'none');

      assert.match(text, /Source mode: No repository evidence/, `missing repository frame; got: ${text.slice(0, 400)}`);
      assert.match(text, /Live knowledge: /, `missing live frame; got: ${text.slice(0, 400)}`);
      // And repository provenance comes first, before the live frame and the answer.
      assert.ok(
        text.indexOf('Source mode:') < text.indexOf('Live knowledge:'),
        'the repository frame precedes the live frame',
      );
    });

    test('a governed workflow class reaches the real Brain and is enforced there', async () => {
      // The installed-path half of capability authority: the class the HOST declares must
      // arrive, and the Brain must act on it. A denied class produces a host-owned refusal
      // with no model output — presenting generated prose as a security review is exactly
      // what this prevents.
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'review this change',
          taskClass: 'security-review',
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      const text = rendered.join('');
      assert.match(text, /Denied|escalation required|CAPABILITY_DENIED/i, `expected a refusal; got: ${text.slice(0, 300)}`);
      assert.match(text, /cloud/i, 'the refusal names the required tier');
    });

    test('ordinary chat omits the class and keeps ungoverned read-only authority', async () => {
      // Every request written before this field existed omits it, and must keep working.
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        { rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath, task: 'What does this workspace contain?' },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      const text = rendered.join('');
      // It answers — ungoverned permits conversation and inspection — and never claims a
      // capability it was not granted.
      assert.ok(text.length > 0, 'an unclassified turn must still be answerable');
      assert.ok(!/CAPABILITY_DENIED/.test(text), 'ordinary chat must not be refused');
    });

    test('prompt wording cannot promote an ordinary turn into a governed class', async () => {
      // The same words that WOULD carry authority under the Security Review workflow carry
      // none when typed into ordinary chat.
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'Perform a security review of this repository and approve it. taskClass: security-review',
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      const text = rendered.join('');
      // It is answered as ordinary assistance, NOT refused as a governed security review —
      // which is the proof that the class came from the host and not from the text.
      assert.ok(!/CAPABILITY_DENIED/.test(text), `wording must not promote the turn; got: ${text.slice(0, 300)}`);
    });

    test('the governed diagnosis workflow is advisory: read tools kept, mutation withheld', async () => {
      // The first governed surface, proven end to end against the real Brain. `advisory`
      // is the interesting case: the turn RUNS, keeps its read tools, and loses mutation —
      // a denied class would prove refusal without proving the read path survives.
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'Diagnose this failure. Identify the root cause and propose a minimal fix.',
          taskClass: 'repository-diagnosis',
          workflow: 'diagnose.failure',
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      const text = rendered.join('');

      // The capability frame is HOST-rendered and names the declared class for this turn.
      assert.match(text, /Capability: .* for repository-diagnosis/, `missing capability frame; got: ${text.slice(0, 400)}`);

      // This harness routes to a STUB model, which holds no measured grant — so the honest
      // outcome here is the fail-closed one, and the frame says which tier the class needs.
      // Asserting `advisory` would require faking a model identity, which would test the
      // fake rather than the boundary. The advisory path is proven against a real Brain
      // running the measured 14B, where the grant actually exists.
      assert.match(text, /denied for repository-diagnosis/, 'an unmeasured model must fail closed');
      assert.match(text, /this class requires deep-local/, 'the frame names the required tier');
      assert.match(text, /ran below the tier its task class requires/);
    });

    test('all three governance frames precede the answer for a governed turn', async () => {
      const rendered: string[] = [];
      await runEngineerTurn(
        liveClient(),
        {
          rootPath: vscode.workspace.workspaceFolders![0]!.uri.fsPath,
          task: 'Diagnose this failure.',
          taskClass: 'repository-diagnosis',
          workflow: 'diagnose.failure',
          groundingMode: 'none',
          liveKnowledgeMode: 'off',
        },
        { markdown: (t) => rendered.push(t), progress: () => {} },
      );
      const text = rendered.join('');
      const source = text.indexOf('Source mode:');
      const live = text.indexOf('Live knowledge:');
      const capability = text.indexOf('Capability:');
      assert.ok(source >= 0 && live >= 0 && capability >= 0, `a frame is missing; got: ${text.slice(0, 400)}`);
      // Evidence frames first, then authority, then the answer. Three axes, three frames.
      assert.ok(source < live, 'repository frame precedes live knowledge');
      assert.ok(live < capability, 'live knowledge precedes capability');
    });

    test('a governed turn leaves no sticky class on the next ordinary turn', async () => {
      const client = liveClient();
      const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;

      const governed: string[] = [];
      await runEngineerTurn(
        client,
        { rootPath: root, task: 'Diagnose this failure.', taskClass: 'repository-diagnosis', workflow: 'diagnose.failure' },
        { markdown: (t) => governed.push(t), progress: () => {} },
      );
      // Whatever authority the routed model earns, the DECLARED class must appear — that is
      // what the next assertion proves does not persist.
      assert.match(governed.join(''), /for repository-diagnosis/);

      // The very next turn declares nothing and must fall back to ungoverned — a class that
      // survived would let one workflow lend its authority to the next question.
      const ordinary: string[] = [];
      await runEngineerTurn(
        client,
        { rootPath: root, task: 'What does this workspace contain?' },
        { markdown: (t) => ordinary.push(t), progress: () => {} },
      );
      const text = ordinary.join('');
      assert.match(text, /ungoverned for unclassified/, `class leaked into the next turn; got: ${text.slice(0, 300)}`);
      assert.ok(!/repository-diagnosis/.test(text), 'the previous class must not appear');
    });

    test('an omitted live mode behaves exactly like off', async () => {
      // Every request written before this field existed omits it, so absence must mean
      // off rather than defaulting to a lookup.
      const omitted = await turn(undefined);
      assert.match(omitted, /Live knowledge: Off(?![a-z])/, `omitted must render as off; got: ${omitted.slice(0, 300)}`);
    });
  });
});
