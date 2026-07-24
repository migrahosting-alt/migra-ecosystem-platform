import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { DiagnosticsGetResponse } from '@migrapilot/protocol';
import { registerMigraPilotParticipant } from './chat/migrapilotParticipant.js';
import { runExplainSelection } from './commands/explainSelection.js';
import { runFixDiagnostics } from './commands/fixDiagnostics.js';
import { type CommitGenResult, runGenerateCommitMessage, runGenerateCommitMessageCommand } from './commands/generateCommitMessage.js';
import { syncDiagnostics, syncDiagnosticsToPilot } from './diagnostics.js';
import { type CommandDeps } from './commands/commandRouting.js';
import { type TestGenDeps, type TestGenResult, runGenerateTests, runGenerateTestsCommand } from './commands/generateTests.js';
import { runReviewApprovals } from './commands/reviewApprovals.js';
import { ApprovalsClient } from '@migrapilot/pilot-client';
import { renderActionConsent } from './services/approvalDelta.js';
import { BackendRouter, type ResolvedBackend } from './services/backendRouter.js';
import {
  BackendDiagnostics,
  type DiagnosticSnapshot,
  type LocalProbe,
  type ResolutionInfo,
} from './services/backendDiagnostics.js';
import { BrainLifecycle, type EnsureResult } from './services/brainLifecycle.js';
import { createRealBrainLauncher } from './services/brainLifecycleVscode.js';
import { BrainClient } from './services/brainClient.js';
import { CAP_DIAGNOSTICS_SYNC, evaluateCapability } from './services/commandCapabilities.js';
import { PilotApiClient } from '@migrapilot/pilot-client';
import { VscodePilotApiConfig, VscodeSecretTokenStore, getMode } from './services/pilotConfigVscode.js';
import {
  ProviderLocalChatBackend,
  VscodeProviderKeyStore,
  buildActiveProvider,
  getProviderKind,
} from './services/providerConfigVscode.js';
import { type ModelProvider } from './providers/modelProvider.js';
import { MigraPilotStatusBar } from './services/statusBar.js';
import { MigraPilotSidebarProvider } from './panel/sidebarView.js';
import { MigraPilotChatViewProvider } from './panel/chatView.js';
import { ProviderRouterClient } from './services/providerRouterClient.js';
import { ExecutionPolicyState } from './services/executionPolicyState.js';
import { setEscalationDispatch, runEscalationConsent } from './services/escalationConsent.js';
import { policyPickItems, policyStatusLabel, providerRows, budgetRows } from './panel/providerRouterViewModel.js';
import { MigraPilotWorkspaceViewProvider } from './panel/workspaceView.js';
import { WorkspaceController } from './panel/workspaceController.js';
import { type WorkspacePanelModel, type RootResolution } from './panel/workspaceViewModel.js';
import { MigraAiClient } from './services/migraAiClient.js';
import { EngineDiagnostics, type EngineDiagnosticSnapshot } from './services/engineDiagnostics.js';
import { type TokenStore } from './services/tokenStore.js';
import { MigraPilotAgentModeViewProvider } from './panel/agentModeView.js';
import { agentModeStatusText } from './panel/agentModeModel.js';

let outputChannel: vscode.OutputChannel;
let brainClient: BrainClient;
let migraAiClient: MigraAiClient;
let engineDiagnostics: EngineDiagnostics;
let statusBar: MigraPilotStatusBar;
let router: BackendRouter;
let tokenStore: TokenStore;
let pilotClient: PilotApiClient;
let commandDeps: CommandDeps;
let testGenDeps: TestGenDeps;
let brainLifecycle: BrainLifecycle;
let providerKeys: VscodeProviderKeyStore;
let makeProvider: () => ModelProvider;
let diagnostics: BackendDiagnostics;
let sidebar: MigraPilotSidebarProvider;
let chatView: MigraPilotChatViewProvider;
let workspaceView: MigraPilotWorkspaceViewProvider;
let workspaceController: WorkspaceController;
let routerClient: ProviderRouterClient;
let policyState: ExecutionPolicyState;
let policyStatusBar: vscode.StatusBarItem;
let pendingResolutionInfo: ResolutionInfo | undefined;
let agentModeView: MigraPilotAgentModeViewProvider;
let agentModeStatusBar: vscode.StatusBarItem;
let agentBootstrapSecret: string | undefined;
let inheritedAgentBootstrapSecret: string | undefined;
let agentActivationPromise: Promise<string> | undefined;

/** Public API returned from activate() — used by the Extension Host tests to
 * drive backend resolution, token storage, and lifecycle without private-state
 * hacks. */
export interface MigraPilotApi {
  router: BackendRouter;
  resolveBackend(force?: boolean): Promise<ResolvedBackend>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  /** Approval lifecycle client (over the same pilotClient) — used by host tests
   * to exercise approve/reject/resume/reconcile against server state. */
  approvals: ApprovalsClient;
  /** Render the user-facing consent view (filtered delta) for an action's
   * change — used by host tests to verify no internal material is displayed. */
  renderConsent(actionId: string): Promise<string>;
  /** The currently-configured model provider (built from settings + SecretStorage
   * key) — used by host tests to prove a real provider run. */
  provider(): ModelProvider;
  setProviderKey(key: string): Promise<void>;
  clearProviderKey(): Promise<void>;
  /** Programmatic test-generation (host tests) — same flow as the command but
   * with a boolean confirm instead of the modal. */
  generateTests(targetRelPath: string, confirm: boolean, opts?: { runCommand?: boolean }): Promise<TestGenResult>;
  /** Read-only commit-message generation (host tests) — never mutates the repo. */
  generateCommitMessage(opts?: { includeUnstaged?: boolean }): Promise<CommitGenResult>;
  /** Local brain lifecycle (auto-start / shutdown). LOCAL only. */
  lifecycle: {
    ensureRunning(): Promise<EnsureResult>;
    shutdown(): Promise<void>;
    ownedPid(): number | undefined;
  };
  /** MigraAI Workspace controls (host tests) — the SAME client + mapper the panel
   * uses, so open/sync/rebuild/approve/delete are exercised end-to-end against the
   * engine. Approve binds to the exact observed index version. */
  workspace: {
    resolveRoot(): RootResolution;
    open(root?: string, opts?: { memoryMode?: 'off' | 'session' | 'durable' }): Promise<WorkspacePanelModel>;
    get(id: string): Promise<WorkspacePanelModel>;
    sync(id: string): Promise<WorkspacePanelModel>;
    rebuild(id: string): Promise<WorkspacePanelModel>;
    approve(id: string, indexVersion: number): Promise<WorkspacePanelModel>;
    setMemoryMode(id: string, mode: 'off' | 'session' | 'durable'): Promise<WorkspacePanelModel>;
    delete(id: string): Promise<{ ok: boolean }>;
    list(): Promise<Array<{ id: string; name: string; root: string }>>;
  };
  /** Sanitized, local-only backend-selection diagnostics snapshot. */
  backendDiagnostics(): DiagnosticSnapshot;
  /** Sanitized, local-only MigraAI Engine routing snapshot (selected model /
   * provider / tier / reason / failed-over models per chat turn). */
  engineDiagnostics(): EngineDiagnosticSnapshot;
}

/** Map a lifecycle result to a coarse local-probe outcome for diagnostics. */
function localProbeFor(result: EnsureResult): LocalProbe {
  switch (result) {
    case 'already-brain':
    case 'started':
      return 'ready';
    case 'conflict':
      return 'conflict';
    case 'unable':
    case 'disabled':
      return 'down';
  }
}

/** Ensure the local brain is running (LOCAL mode only). Reads config for the
 * brain URL, autoStart flag, and launch command. pilot-api is never touched. */
async function ensureBrainRunning(): Promise<EnsureResult> {
  const cfg = vscode.workspace.getConfiguration('migrapilot');
  const url = String(cfg.get('brainUrl', 'http://127.0.0.1:3988'));
  const autoStart = cfg.get<boolean>('autoStartBrain', true);
  const command = cfg.get<string[]>('brainAutoStartCommand', []);
  agentBootstrapSecret ??= randomBytes(32).toString('base64url');
  const launchSecret = agentBootstrapSecret;
  const result = await brainLifecycle.ensureRunning({ url, autoStart, command, environment: { MIGRAPILOT_AGENT_BOOTSTRAP_SECRET: launchSecret, MIGRAPILOT_AGENT_EXTENSION_PID: String(process.pid) } });
  output(`brain lifecycle: ${result}`);
  // Observational: attach the local probe outcome to the latest diagnostic event.
  diagnostics.annotateLocalProbe(localProbeFor(result));
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (root && (result === 'started' || inheritedAgentBootstrapSecret)) {
    void ensureAgentAuthorization(root, result === 'started' ? launchSecret : inheritedAgentBootstrapSecret, 'inherited').catch((error) => output(`Agent authorization unavailable: ${error instanceof Error ? error.message : 'pairing required'}`));
  }
  return result;
}

async function ensureAgentAuthorization(root: string, explicitSecret?: string, bootstrapMode: 'inherited' | 'pairing' = 'inherited'): Promise<string> {
  const existing = migraAiClient.agentActivationWorkspace();
  if (existing) return existing;
  const secret = explicitSecret ?? (brainLifecycle.ownedPid() ? agentBootstrapSecret : undefined);
  if (!secret) throw new Error('Secure Agent pairing is required for the attached brain service.');
  agentActivationPromise ??= migraAiClient.bootstrapAgentMode(secret, root, bootstrapMode).then((activation) => {
    if (secret === agentBootstrapSecret) agentBootstrapSecret = undefined;
    if (secret === inheritedAgentBootstrapSecret) inheritedAgentBootstrapSecret = undefined;
    return activation.canonicalWorkspace;
  }).finally(() => { agentActivationPromise = undefined; });
  return agentActivationPromise;
}

export async function activate(context: vscode.ExtensionContext): Promise<MigraPilotApi> {
  agentBootstrapSecret = randomBytes(32).toString('base64url');
  inheritedAgentBootstrapSecret = process.env.MIGRAPILOT_AGENT_BOOTSTRAP_SECRET;
  delete process.env.MIGRAPILOT_AGENT_BOOTSTRAP_SECRET;
  outputChannel = vscode.window.createOutputChannel('MigraPilot');
  brainClient = new BrainClient(outputChannel);
  // MigraAI Engine client — the local chat path streams through /api/ai/chat.
  // The engine is served by brain-service, so it shares the brain base URL.
  migraAiClient = new MigraAiClient({
    baseUrl: () => String(vscode.workspace.getConfiguration('migrapilot').get('brainUrl', 'http://127.0.0.1:3988')),
    timeoutMs: () => Number(vscode.workspace.getConfiguration('migrapilot').get('requestTimeoutMs', 30000)),
    log: (message) => output(message),
    // Memory isolation: one workspace's conversations never leak into another.
    scope: () => ({ owner: 'local', workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default' }),
  });
  engineDiagnostics = new EngineDiagnostics(() => Date.now());
  statusBar = new MigraPilotStatusBar();

  tokenStore = new VscodeSecretTokenStore(context.secrets);
  pilotClient = new PilotApiClient(new VscodePilotApiConfig(tokenStore, outputChannel));
  providerKeys = new VscodeProviderKeyStore(context.secrets);
  makeProvider = () => buildActiveProvider(providerKeys, outputChannel);
  diagnostics = new BackendDiagnostics(() => Date.now());
  router = new BackendRouter({
    mode: getMode,
    // Local chat runs through the configured model provider (default: stub).
    local: new ProviderLocalChatBackend(makeProvider),
    pilot: pilotClient,
    log: output,
    // Observational only — records why a backend was selected; never affects it.
    onResolution: (info) => {
      pendingResolutionInfo = info;
    },
  });
  commandDeps = { brainClient, router, pilot: pilotClient, migraAi: migraAiClient, output: outputChannel };
  testGenDeps = { ...commandDeps, makeProvider };
  brainLifecycle = new BrainLifecycle(createRealBrainLauncher(), output);

  // Intelligent Provider Router — Slice 5: read-only client + policy preference.
  routerClient = new ProviderRouterClient({
    baseUrl: () => String(vscode.workspace.getConfiguration('migrapilot').get('brainUrl', 'http://127.0.0.1:3988')),
    timeoutMs: () => Number(vscode.workspace.getConfiguration('migrapilot').get('requestTimeoutMs', 30000)),
    log: (m) => output(m),
  });
  policyState = new ExecutionPolicyState(context.workspaceState);
  // Slice 5: the cloud-escalation consent modal. Nothing is approved silently —
  // only "Approve once" submits the server-issued offer reference for one call.
  setEscalationDispatch(async (offer, render) => {
    const outcome = await runEscalationConsent(offer as never, routerClient, {
      pickAction: async (card) => {
        const choice = await vscode.window.showWarningMessage([card.title, '', ...card.lines].join('\n'), { modal: true }, 'Approve once', 'Stay local');
        return choice === 'Approve once' ? 'Approve once' : 'Stay local';
      },
      info: (m) => void vscode.window.showInformationMessage(m),
      error: (m) => void vscode.window.showWarningMessage(m),
    });
    if (outcome.kind === 'approved' && outcome.result.ok && outcome.result.content) render(`\n\n${outcome.result.content}`);
  });
  context.subscriptions.push({ dispose: () => setEscalationDispatch(undefined) });
  policyStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  policyStatusBar.command = 'migrapilot.executionPolicy';
  policyStatusBar.tooltip = 'MigraPilot execution policy (local-first; cloud is a gated fallback)';
  refreshPolicyStatusBar();
  policyStatusBar.show();
  context.subscriptions.push(policyStatusBar);

  registerMigraPilotParticipant(context, brainClient, router, migraAiClient, engineDiagnostics);

  sidebar = new MigraPilotSidebarProvider(context.extensionUri, {
    brainClient,
    router,
    providerKind: getProviderKind,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MigraPilotSidebarProvider.viewType, sidebar),
  );

  agentModeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  agentModeStatusBar.command = 'migrapilot.openAgentMode';
  agentModeStatusBar.text = agentModeStatusText(false, 'IDLE');
  agentModeStatusBar.tooltip = 'Explicit Agent Mode command approval control plane';
  agentModeStatusBar.show();
  agentModeView = new MigraPilotAgentModeViewProvider(context.extensionUri, {
    client: migraAiClient,
    workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    authorizeWorkspace: (root) => ensureAgentAuthorization(root),
    memento: context.workspaceState,
    output: outputChannel,
    onMode: (enabled, state) => { agentModeStatusBar.text = agentModeStatusText(enabled, state); },
  });
  context.subscriptions.push(
    agentModeStatusBar,
    vscode.window.registerWebviewViewProvider(MigraPilotAgentModeViewProvider.viewType, agentModeView, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('migrapilot.openAgentMode', async () => agentModeView.reveal()),
    vscode.commands.registerCommand('migrapilot.pairAgentMode', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) return void vscode.window.showWarningMessage('Open a workspace before pairing Agent Mode.');
      const secret = await vscode.window.showInputBox({ title: 'Pair Agent Mode', prompt: 'Enter the one-time bootstrap secret shown by the local brain operator.', password: true, ignoreFocusOut: true });
      if (!secret) return;
      try { await ensureAgentAuthorization(root, secret, 'pairing'); await vscode.window.showInformationMessage('Agent Mode paired for this extension activation and workspace.'); }
      catch { await vscode.window.showErrorMessage('Agent Mode pairing was refused or expired.'); }
    }),
  );

  // Dedicated chat panel (Claude Code / Copilot-style) — its own webview, no
  // `@migrapilot` mention required. Reuses the same backend turn pipeline as the
  // native participant. retainContextWhenHidden keeps the transcript alive when
  // the view is collapsed or hidden.
  chatView = new MigraPilotChatViewProvider(context.extensionUri, {
    brainClient,
    router,
    migraAiClient,
    engineDiagnostics,
    memoryMode: () => {
      const m = String(vscode.workspace.getConfiguration('migrapilot').get('memoryMode', 'session'));
      return m === 'off' || m === 'durable' ? m : 'session';
    },
    executionPolicy: () => policyState.get(),
    conversationMemento: context.workspaceState,
    output: outputChannel,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MigraPilotChatViewProvider.viewType, chatView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('migrapilot.openChat', async () => {
      await vscode.commands.executeCommand('migrapilot.chatView.focus');
      chatView.reveal();
    }),
  );

  // MigraAI Workspace panel — an operational view of the workspace product object
  // (semantic index, memory, agents, models, engine) and thin controls over the
  // engine's `/api/ai/workspaces` endpoints. Read-only until an action is taken;
  // every action re-reads authoritative engine state.
  workspaceController = new WorkspaceController(
    migraAiClient,
    () => (vscode.workspace.workspaceFolders ?? []).map((f) => ({ name: f.name, fsPath: f.uri.fsPath })),
  );
  workspaceView = new MigraPilotWorkspaceViewProvider(context.extensionUri, {
    controller: workspaceController,
    output: outputChannel,
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(MigraPilotWorkspaceViewProvider.viewType, workspaceView, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('migrapilot.openWorkspacePanel', async () => {
      await vscode.commands.executeCommand('migrapilot.workspace.focus');
    }),
  );

  context.subscriptions.push(outputChannel, statusBar.disposable);
  context.subscriptions.push(
    vscode.commands.registerCommand('migrapilot.health', checkHealth),
    vscode.commands.registerCommand('migrapilot.repairConnection', repairConnection),
    vscode.commands.registerCommand('migrapilot.showLogs', () => outputChannel.show(true)),
    vscode.commands.registerCommand('migrapilot.showDiagnostics', showDiagnostics),
    vscode.commands.registerCommand('migrapilot.productionDiagnostics', productionDiagnosticsStatus),
    vscode.commands.registerCommand('migrapilot.executionPolicy', chooseExecutionPolicy),
    vscode.commands.registerCommand('migrapilot.providerStatus', showProviderStatus),
    vscode.commands.registerCommand('migrapilot.aiUsage', showAiUsage),
    vscode.commands.registerCommand('migrapilot.explainSelection', () => runExplainSelection(commandDeps)),
    vscode.commands.registerCommand('migrapilot.fixDiagnostics', () => runFixDiagnostics(commandDeps)),
    vscode.commands.registerCommand('migrapilot.generateTests', () => runGenerateTestsCommand(testGenDeps)),
    vscode.commands.registerCommand('migrapilot.generateCommit', () => runGenerateCommitMessageCommand(testGenDeps)),
    vscode.commands.registerCommand('migrapilot.setToken', setToken),
    vscode.commands.registerCommand('migrapilot.clearToken', clearToken),
    vscode.commands.registerCommand('migrapilot.reviewApprovals', () => runReviewApprovals(commandDeps)),
    vscode.commands.registerCommand('migrapilot.setProviderKey', setProviderKey),
    vscode.commands.registerCommand('migrapilot.clearProviderKey', clearProviderKey),
    vscode.commands.registerCommand('migrapilot.providerInfo', providerInfo),
    vscode.commands.registerCommand('migrapilot.showBackendDiagnostics', showBackendDiagnostics),
  );

  context.subscriptions.push(
    vscode.languages.onDidChangeDiagnostics(() => {
      void syncWorkspaceDiagnostics();
    }),
  );

  // Resolve the backend ONCE at activation and reflect it in the status bar.
  const resolved = await resolveBackend(false);
  // In local mode, best-effort ensure the local brain is running — non-blocking
  // so activation never waits on the network or a spawn.
  if (resolved.kind === 'local') {
    void ensureBrainRunning().then((r) => statusBar.showLocalLifecycle(r));
  }
  await syncWorkspaceDiagnostics();
  output(`Model provider: ${getProviderKind()}.`);
  output('MigraPilot extension activated.');

  return {
    router,
    resolveBackend,
    setToken: (token: string) => tokenStore.set(token),
    clearToken: () => tokenStore.delete(),
    approvals: new ApprovalsClient(pilotClient),
    renderConsent: async (actionId: string) => {
      const action = await new ApprovalsClient(pilotClient).get(actionId);
      return action.change ? renderActionConsent(action.change) : '';
    },
    provider: makeProvider,
    setProviderKey: (key: string) => Promise.resolve(providerKeys.set(key)).then(() => undefined),
    clearProviderKey: () => Promise.resolve(providerKeys.delete()).then(() => undefined),
    generateTests: (targetRelPath: string, confirm: boolean, opts?: { runCommand?: boolean }) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return Promise.resolve<TestGenResult>({ status: 'error', reason: 'no workspace folder' });
      }
      return runGenerateTests(testGenDeps, targetRelPath, folder.uri.fsPath, async () => confirm, opts ?? {});
    },
    generateCommitMessage: (opts?: { includeUnstaged?: boolean }) => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        return Promise.resolve<CommitGenResult>({ status: 'error', reason: 'no workspace folder' });
      }
      return runGenerateCommitMessage(testGenDeps, folder.uri.fsPath, opts ?? {});
    },
    lifecycle: {
      ensureRunning: ensureBrainRunning,
      shutdown: () => brainLifecycle.shutdown(),
      ownedPid: () => brainLifecycle.ownedPid(),
    },
    workspace: {
      resolveRoot: () => workspaceController.resolveRoot(),
      open: (root, opts) => {
        let target = root;
        if (!target) {
          const res = workspaceController.resolveRoot();
          if (res.kind === 'root') target = res.root;
          else throw new Error(res.kind === 'none' ? 'no workspace folder open' : 'multiple folders open — a root must be selected');
        }
        return workspaceController.open(target, opts);
      },
      get: (id) => workspaceController.get(id),
      sync: (id) => workspaceController.sync(id),
      rebuild: (id) => workspaceController.rebuild(id),
      approve: (id, indexVersion) => workspaceController.approve(id, indexVersion),
      setMemoryMode: (id, mode) => workspaceController.setMemoryMode(id, mode),
      delete: (id) => workspaceController.delete(id),
      list: () => workspaceController.list().then((ws) => ws.map((w) => ({ id: w.id, name: w.name, root: w.root }))),
    },
    backendDiagnostics: () => diagnostics.snapshot(),
    engineDiagnostics: () => engineDiagnostics.snapshot(),
  };
}

/** Resolve the backend and reflect it in the status bar. force=true re-resolves
 * (explicit repair / after mode or token change). Records a sanitized diagnostic
 * event (observational — never affects the resolution). */
async function resolveBackend(force: boolean): Promise<ResolvedBackend> {
  pendingResolutionInfo = undefined;
  let resolved: ResolvedBackend;
  try {
    resolved = await router.resolve(force);
  } catch (error) {
    output(`Backend resolution failed: ${error instanceof Error ? error.message : String(error)}`);
    resolved = { kind: 'local', note: 'resolution-error' };
  }
  statusBar.showBackend(resolved);
  void sidebar?.refresh();
  if (pendingResolutionInfo) {
    diagnostics.record(pendingResolutionInfo, {
      source: getMode() === 'auto' ? 'auto' : 'explicit',
      trigger: force ? 're-resolve' : 'activation',
    });
  }
  return resolved;
}

async function setToken(): Promise<void> {
  const token = await vscode.window.showInputBox({
    prompt: 'Paste the MigraPilot Pilot service token (stored in SecretStorage).',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) {
    return;
  }
  await tokenStore.set(token.trim());
  // Never log or echo the token value.
  output('Pilot token stored in SecretStorage.');
  await resolveBackend(true);
}

async function clearToken(): Promise<void> {
  await tokenStore.delete();
  output('Pilot token cleared from SecretStorage.');
  await resolveBackend(true);
}

async function setProviderKey(): Promise<void> {
  const key = await vscode.window.showInputBox({
    prompt: 'Paste the model provider API key (stored in SecretStorage).',
    password: true,
    ignoreFocusOut: true,
  });
  if (!key) {
    return;
  }
  await providerKeys.set(key.trim());
  output('Model provider API key stored in SecretStorage.'); // never logs the value
}

async function clearProviderKey(): Promise<void> {
  await providerKeys.delete();
  output('Model provider API key cleared from SecretStorage.');
}

async function showBackendDiagnostics(): Promise<void> {
  // Render the sanitized snapshots as read-only JSON. Contains no secrets by
  // construction; opening it never triggers resolution/repair. Includes the
  // MigraAI Engine routing history (selected model / provider / tier / reason /
  // failed-over models per chat turn).
  const snapshot = {
    backendSelection: diagnostics.snapshot(),
    engineRouting: engineDiagnostics.snapshot(),
  };
  const doc = await vscode.workspace.openTextDocument({
    language: 'json',
    content: JSON.stringify(snapshot, null, 2),
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

async function providerInfo(): Promise<void> {
  // Identity only — provider id + model, never the key.
  try {
    const caps = makeProvider().capabilities();
    const message = `MigraPilot provider: ${caps.providerId} · model ${caps.model} · streaming ${caps.streaming}`;
    output(message);
    await vscode.window.showInformationMessage(message);
  } catch (error) {
    const message = `MigraPilot provider: ${getProviderKind()} (not fully configured: ${error instanceof Error ? error.message : String(error)})`;
    output(message);
    await vscode.window.showWarningMessage(message);
  }
}

export async function deactivate(): Promise<void> {
  // Kill ONLY the brain process this extension started (adopted brains untouched).
  await brainLifecycle?.shutdown();
  output('MigraPilot extension deactivated.');
}

async function checkHealth(): Promise<void> {
  try {
    const health = await brainClient.health();
    const message = `MigraPilot brain is ${health.status}. Version ${health.version}. Uptime ${health.uptimeSec}s.`;
    output(message);
    await vscode.window.showInformationMessage(message, 'Show Logs');
  } catch (error) {
    const message = formatError('Health check failed', error);
    output(message);
    await vscode.window
      .showErrorMessage(message, 'Repair Connection', 'Show Logs')
      .then(async (choice) => {
        if (choice === 'Repair Connection') {
          await repairConnection();
        }
        if (choice === 'Show Logs') {
          outputChannel.show(true);
        }
      });
  } finally {
    await statusBar.refresh(brainClient);
    void sidebar?.refresh();
  }
}

function refreshPolicyStatusBar(): void {
  if (!policyStatusBar) return;
  policyStatusBar.text = `$(server-process) ${policyState.get()}`;
}

/** Execution-policy selector (Slice 5). Reads policy definitions from the server
 * (authoritative) and lets the user pick a per-request PREFERENCE. Never grants
 * permission to bypass local-first, consent, privacy, or budget. */
async function chooseExecutionPolicy(): Promise<void> {
  let policies;
  try {
    policies = (await routerClient.getPolicies()).policies;
  } catch (error) {
    await vscode.window.showErrorMessage(formatError('Could not load execution policies from the engine', error));
    return;
  }
  const items = policyPickItems(policies, policyState.get() as never).map((it) => ({ label: it.label, description: it.description, id: it.id }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'MigraPilot — Execution Policy',
    placeHolder: 'Local-first is always the architecture; cloud is a gated, consented fallback.',
    matchOnDescription: true,
  });
  if (!picked) return;
  await policyState.set(picked.id);
  refreshPolicyStatusBar();
  const label = policyStatusLabel(policies, picked.id as never);
  await vscode.window.showInformationMessage(`${label}. This is a per-request preference — the engine resolves the effective policy and enforces routing, consent, privacy, and budget.`);
}

/** Read-only provider status (Slice 5). Shows the fleet without credential values. */
async function showProviderStatus(): Promise<void> {
  try {
    const { providers } = await routerClient.getProviders();
    const items = providerRows(providers).map((r) => ({ label: `${r.name} · ${r.type}`, description: `${r.health}${r.note ? ` — ${r.note}` : ''}`, detail: `Capabilities: ${r.capabilities}${r.model ? ` · Model: ${r.model}` : ''}` }));
    await vscode.window.showQuickPick(items, { title: 'MigraPilot — Providers (read-only)', placeHolder: 'Provider status. No credentials or endpoints are shown.' });
  } catch (error) {
    await vscode.window.showErrorMessage(formatError('Could not load provider status', error));
  }
}

/** Read-only AI usage + budget (Slice 5). */
async function showAiUsage(): Promise<void> {
  try {
    const [budget, usage] = await Promise.all([routerClient.getBudget(), routerClient.getUsage({ limit: 1 })]);
    const rows = budgetRows(budget, usage).map((r) => `${r.label}: ${r.value}`);
    await vscode.window.showInformationMessage(`AI Usage — ${rows.join(' · ')}`, 'OK');
  } catch (error) {
    await vscode.window.showErrorMessage(formatError('Could not load AI usage', error));
  }
}

/** Read-Only Production Diagnostics status (Slice 5). Surfaces the brain's
 * dedicated production-diagnostics provider status, clearly labeled read-only.
 * This command NEVER mutates production; it only reads the provider's status. */
async function productionDiagnosticsStatus(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('migrapilot');
  const base = String(cfg.get('brainUrl', 'http://127.0.0.1:3988'));
  try {
    const res = await fetch(`${base}/api/ai/production-diagnostics/status`);
    const s = (await res.json()) as { mode?: string; enabled?: boolean; targetCount?: number; capabilityCount?: number };
    const label = s.mode ?? 'Production Diagnostics — Read Only';
    const state = s.enabled ? 'ENABLED (read-only)' : 'DISABLED (fail-closed)';
    const message = `${label}: ${state}. Targets: ${s.targetCount ?? 0}. Read-only capabilities: ${s.capabilityCount ?? 0}.`;
    output(message);
    await vscode.window.showInformationMessage(message, 'Show Logs').then((c) => {
      if (c === 'Show Logs') outputChannel.show(true);
    });
  } catch (error) {
    const message = formatError('Production Diagnostics status unavailable', error);
    output(message);
    await vscode.window.showErrorMessage(message);
  }
}

async function repairConnection(): Promise<void> {
  output('Repair: re-resolving backend.');
  // Explicit repair is the one place (besides activation) allowed to re-resolve
  // the backend — mode/token/health may have changed.
  const resolved = await resolveBackend(true);
  // In local mode, repair also attempts to (re)start the local brain.
  if (resolved.kind === 'local') {
    const life = await ensureBrainRunning();
    statusBar.showLocalLifecycle(life);
  }
  const label =
    resolved.kind === 'remote'
      ? 'pilot-api'
      : resolved.kind === 'remote-unavailable'
        ? `pilot-api unavailable (${resolved.error.code})`
        : 'local brain-service';
  await vscode.window
    .showInformationMessage(`MigraPilot backend: ${label}.`, 'Open Settings', 'Show Logs')
    .then(async (choice) => {
      if (choice === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'migrapilot');
      }
      if (choice === 'Show Logs') {
        outputChannel.show(true);
      }
    });

  await statusBar.refresh(brainClient);
}

async function showDiagnostics(): Promise<void> {
  const rootPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!rootPath) {
    void vscode.window.showWarningMessage('No workspace folder open.');
    return;
  }

  await syncWorkspaceDiagnostics();

  const result = await migraAiClient.runReadOnlyTool<DiagnosticsGetResponse>('diagnostics.get', { rootPath });

  const count = result.items.length;
  void vscode.window.showInformationMessage(`MigraPilot diagnostics available: ${count}`);
  output(`Diagnostics fetched: ${count}`);
}


function output(message: string): void {
  const timestamp = new Date().toISOString();
  outputChannel.appendLine(`[${timestamp}] ${message}`);
}

async function syncWorkspaceDiagnostics(): Promise<void> {
  // Route diagnostics sync to the resolved backend. Remote sync requires the
  // workspace.read capability; if a remote backend can't prove it (or is
  // unavailable), skip quietly — this is a background op, not a user command,
  // so it never surfaces an error or silently mixes backends.
  try {
    const backend = router?.current();
    if (!backend || backend.kind === 'local') {
      await syncDiagnostics(brainClient.baseUrl);
      output('Diagnostics synced (local).');
      return;
    }
    const decision = evaluateCapability(backend, CAP_DIAGNOSTICS_SYNC);
    if (decision.mode === 'remote') {
      await syncDiagnosticsToPilot(pilotClient);
      output('Diagnostics synced (pilot-api).');
      return;
    }
    output(
      `Diagnostics sync skipped: ${decision.mode === 'denied' ? decision.error.code : 'unresolved backend'}.`,
    );
  } catch (error) {
    output(`Diagnostics sync failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatError(prefix: string, error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `${prefix}: ${text}`;
}
