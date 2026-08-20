import { capabilityStatusLine } from './services/capabilityContractVscode.js';
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import type { DiagnosticsGetResponse } from '@migrapilot/protocol';
import { registerMigraPilotParticipant } from './chat/migrapilotParticipant.js';
import { runExplainSelection } from './commands/explainSelection.js';
import { runFixDiagnostics } from './commands/fixDiagnostics.js';
import { runDiagnoseFailure } from './commands/diagnoseFailure.js';
import { recentCorrelations, type CorrelationEntry } from './interaction/correlationLog.js';
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
import { BrainClient, callBrainTool } from './services/brainClient.js';
import { vscodeBrainConfig } from './services/brainConfigVscode.js';
import {
  bootstrapBrainStore,
  connectionPersister,
  recoveredStatusLine,
  type BrainBootstrap,
} from './services/brainStoreVscode.js';
import { CAP_DIAGNOSTICS_SYNC, evaluateCapability } from './services/commandCapabilities.js';
import { PilotApiClient } from '@migrapilot/pilot-client';
import { VscodePilotApiConfig, VscodeSecretTokenStore, getMode } from './services/pilotConfigVscode.js';
import { BrainLocalChatBackend } from './services/brainLocalChatBackend.js';
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
import { CodingRunClient } from './services/codingRunClient.js';
import { registerGovernedCodingCommand, restoreGovernedCodingRun } from './commands/governedCoding.js';
import { runAdHocCommand } from './commands/runCommand.js';
import { runQuickEdit } from './commands/quickEdit.js';
import { runGitOverview } from './commands/gitOverview.js';
import { runTests } from './commands/runTests.js';
import type { GovernedCodingUiFactory } from './services/governedCodingUi.js';
import { EngineDiagnostics, type EngineDiagnosticSnapshot } from './services/engineDiagnostics.js';
import { type TokenStore } from './services/tokenStore.js';
import { MigraPilotAgentModeViewProvider } from './panel/agentModeView.js';
import { agentModeStatusText } from './panel/agentModeModel.js';
import { MigraPilotShell } from './panel/shell/shellProvider.js';
import { MigraPilotStudioPanel } from './panel/shell/studioPanel.js';
import { type ShellTabId } from './panel/shell/navigationModel.js';

let outputChannel: vscode.OutputChannel;
let brainBootstrap: BrainBootstrap | undefined;
let brainClient: BrainClient;
let migraAiClient: MigraAiClient;
let codingRunClient: CodingRunClient;
let governedCoding: ReturnType<typeof registerGovernedCodingCommand>;
let engineDiagnostics: EngineDiagnostics;
let statusBar: MigraPilotStatusBar;
let router: BackendRouter;
let tokenStore: TokenStore;
let pilotClient: PilotApiClient;
let commandDeps: CommandDeps;
let testGenDeps: TestGenDeps;
let brainLifecycle: BrainLifecycle;
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
let shell: MigraPilotShell;
let studioPanel: MigraPilotStudioPanel;
let agentModeStatusBar: vscode.StatusBarItem;
let agentBootstrapSecret: string | undefined;
let inheritedAgentBootstrapSecret: string | undefined;
let agentActivationPromise: Promise<string> | undefined;

/** Public API returned from activate() — used by the Extension Host tests to
 * drive backend resolution, token storage, and lifecycle without private-state
 * hacks. */
export interface MigraPilotApi {
  router: BackendRouter;
  /**
   * Recent engineer-turn correlation ids, newest first.
   *
   * Exposed through the extension API rather than a shared module, because a caller may hold
   * a different copy of the module — the packaged bundle inlines its own — and reading module
   * state across that boundary silently returns an empty list.
   */
  interactionCorrelations(limit?: number): CorrelationEntry[];
  resolveBackend(force?: boolean): Promise<ResolvedBackend>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
  /** Approval lifecycle client (over the same pilotClient) — used by host tests
   * to exercise approve/reject/resume/reconcile against server state. */
  approvals: ApprovalsClient;
  /** Render the user-facing consent view (filtered delta) for an action's
   * change — used by host tests to verify no internal material is displayed. */
  renderConsent(actionId: string): Promise<string>;
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
  /** Superseded-surface observability for the installed-acceptance gate.
   *
   * The Command Center is the canonical interface; the classic Chat and Agent
   * Mode views are retained but their contributions are gated behind
   * `migrapilot.enableClassicViews`. On a default install both `*Resolved()`
   * must be false — VS Code never asked them to render — which is what proves
   * the old chat UI cannot appear from the activity-bar icon. */
  classicViews: {
    enabled(): boolean;
    chatResolved(): boolean;
    agentModeResolved(): boolean;
  };
  /** Command Center observability for the installed-acceptance gate: the exact
   * state the shell would render, plus the ability to drive a tab load and a
   * Workspace-tab control the way a click would. */
  shell: {
    state(): unknown;
    loadTab(tab: string): Promise<void>;
    workspaceIntent(intent: string): Promise<void>;
  };
  /** Sanitized, local-only backend-selection diagnostics snapshot. */
  backendDiagnostics(): DiagnosticSnapshot;
  /** Sanitized, local-only MigraAI Engine routing snapshot (selected model /
   * provider / tier / reason / failed-over models per chat turn). */
  engineDiagnostics(): EngineDiagnosticSnapshot;
  /** Governed coding, for the installed-path acceptance gate. `restore` asks the
   * Brain what happened to a remembered run — it never infers from the extension
   * having restarted. */
  governedCoding: {
    restore(): Promise<void>;
    client(): CodingRunClient;
    /** Supply a scripted interaction sequence. Packaged acceptance ONLY: it
     * injects user responses, never the client, workspace, snapshots, mutation
     * decisions or completion state. */
    setUi(factory: GovernedCodingUiFactory): void;
  };
}

/** True when the developer opted into the superseded classic sidebar views. */
function classicViewsEnabled(): boolean {
  return vscode.workspace.getConfiguration('migrapilot').get<boolean>('enableClassicViews', false) === true;
}

/**
 * Guard for the developer-only classic-view commands.
 *
 * The view CONTRIBUTIONS are gated on `config.migrapilot.enableClassicViews`, so
 * focusing them while the setting is off would fail with an opaque VS Code error.
 * Refuse explicitly instead, and offer the setting — the Command Center remains
 * the canonical surface either way.
 *
 * The refusal notice is dispatched WITHOUT awaiting: a command must never hold
 * its promise open until a human dismisses a dialog. The follow-up choice is
 * handled asynchronously.
 */
function requireClassicViews(label: string): boolean {
  if (classicViewsEnabled()) return true;
  void vscode.window
    .showWarningMessage(
      `${label} is a superseded developer-only view. The canonical interface is the MigraPilot Command Center.`,
      'Open Command Center',
      'Enable Classic Views',
    )
    .then(async (choice) => {
      if (choice === 'Open Command Center') {
        await studioPanel.reveal('chat');
      } else if (choice === 'Enable Classic Views') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'migrapilot.enableClassicViews');
      }
    });
  return false;
}

/** Narrow a loosely-typed command argument to a shell tab id. */
function isShellTabArg(value: unknown): value is ShellTabId {
  return value === 'chat' || value === 'agent' || value === 'diff' || value === 'audit' || value === 'workspace';
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
  // Canonical activity: the shell reports what the lifecycle ACTUALLY returned.
  shell?.recordActivity(
    `Brain lifecycle: ${result}`,
    result === 'started' || result === 'already-brain' ? 'ok' : result === 'disabled' ? 'info' : 'warn',
  );
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

  // ── Durable execution authority ──────────────────────────────────────────
  // Steps 1-5 of the activation contract. This MUST complete before any health
  // probe or Brain operation begins: a probe that lands first would overwrite the
  // recovered state the user is shown, so an interrupted run would look fine.
  try {
    brainBootstrap = await bootstrapBrainStore(context, (m) => output(m));
    const recoveredLine = recoveredStatusLine(brainBootstrap.recovered);
    if (recoveredLine) {
      // 6 — publish recovered status BEFORE polling starts.
      output(recoveredLine);
      void vscode.window.showWarningMessage(recoveredLine);
    }
  } catch (err) {
    // Persistence is unavailable. Say so plainly rather than running as if durable.
    output(`brain-store: UNAVAILABLE — ${String(err)}. Runtime state will not be durable.`);
  }

  // Connection readiness becomes durable here. The persister is narrow by type — it
  // cannot reach an operation record — so injecting it carries none of the
  // writers-before-recovery hazard. Absent a store, the client simply runs
  // non-durably rather than pretending otherwise.
  brainClient = new BrainClient(
    outputChannel,
    vscodeBrainConfig(),
    undefined,
    undefined,
    undefined,
    brainBootstrap ? connectionPersister(brainBootstrap.store, (m) => output(m)) : undefined,
    // Operation state becomes durable in production here.
    brainBootstrap?.store,
  );
  // MigraAI Engine client — the local chat path streams through /api/ai/chat.
  // The engine is served by brain-service, so it shares the brain base URL.
  migraAiClient = new MigraAiClient({
    baseUrl: () => String(vscode.workspace.getConfiguration('migrapilot').get('brainUrl', 'http://127.0.0.1:3988')),
    timeoutMs: () => Number(vscode.workspace.getConfiguration('migrapilot').get('requestTimeoutMs', 30000)),
    log: (message) => output(message),
    // Memory isolation: one workspace's conversations never leak into another.
    scope: () => ({ owner: 'local', workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'default' }),
  });
  // Governed coding runs. Shares the brain base URL; a longer timeout than chat
  // because planning and validation are server-side stages, not a streamed reply.
  codingRunClient = new CodingRunClient({
    baseUrl: () => String(vscode.workspace.getConfiguration('migrapilot').get('brainUrl', 'http://127.0.0.1:3988')),
    timeoutMs: () => Number(vscode.workspace.getConfiguration('migrapilot').get('requestTimeoutMs', 30000)),
    log: (message) => output(message),
  });
  // Registered once here so the packaged acceptance can drive THIS registration
  // with a scripted interaction rather than a second copy of the command.
  governedCoding = registerGovernedCodingCommand(context, {
    client: codingRunClient,
    log: (message) => output(message),
  });
  engineDiagnostics = new EngineDiagnostics(() => Date.now());
  statusBar = new MigraPilotStatusBar();

  tokenStore = new VscodeSecretTokenStore(context.secrets);
  pilotClient = new PilotApiClient(new VscodePilotApiConfig(tokenStore, outputChannel));
  diagnostics = new BackendDiagnostics(() => Date.now());
  router = new BackendRouter({
    mode: getMode,
    // Local chat runs through the canonical Brain. The extension has no
    // model provider of its own — see brainLocalChatBackend.ts.
    local: new BrainLocalChatBackend(() => brainClient),
    pilot: pilotClient,
    log: output,
    // Observational only — records why a backend was selected; never affects it.
    onResolution: (info) => {
      pendingResolutionInfo = info;
    },
  });
  commandDeps = { brainClient, router, pilot: pilotClient, migraAi: migraAiClient, output: outputChannel };
  testGenDeps = commandDeps;
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
  // The execution policy is administrative and Agent Mode is a mechanism. Both had
  // permanent items in VS Code's status bar — "auto" and "Agent Mode: OFF" — which
  // is backend state on the strip a person reads while writing code. They are
  // created either way, so nothing about their behaviour changes; they are only
  // SHOWN in developer mode.
  policyStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
  policyStatusBar.command = 'migrapilot.executionPolicy';
  policyStatusBar.tooltip = 'MigraPilot execution policy (local-first; cloud is a gated fallback)';
  refreshPolicyStatusBar();
  if (developerModeEnabled()) policyStatusBar.show();
  context.subscriptions.push(policyStatusBar);

  registerMigraPilotParticipant(context, brainClient, router, migraAiClient, engineDiagnostics);

  agentModeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
  agentModeStatusBar.command = 'migrapilot.openAgentMode';
  agentModeStatusBar.text = agentModeStatusText(false, 'IDLE');
  agentModeStatusBar.tooltip = 'Explicit Agent Mode command approval control plane';
  if (developerModeEnabled()) agentModeStatusBar.show();
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
    // The classic Agent Mode view stays REGISTERED but its view contribution is
    // gated on `migrapilot.enableClassicViews`, so the provider is inert until a
    // developer opts in. Registering unconditionally means flipping the setting
    // takes effect immediately, without a window reload.
    vscode.window.registerWebviewViewProvider(MigraPilotAgentModeViewProvider.viewType, agentModeView, { webviewOptions: { retainContextWhenHidden: true } }),
    // PRESERVED command id, re-pointed to the canonical surface: the Command
    // Center's Agent Workspace is now the one governed approval path, so this
    // command (and the Agent Mode status-bar item) can never target a view that
    // is hidden by default.
    vscode.commands.registerCommand('migrapilot.openAgentMode', async () => studioPanel.reveal('agent')),
    vscode.commands.registerCommand('migrapilot.pairAgentMode', async () => {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) return void vscode.window.showWarningMessage('Open a workspace before pairing Agent Mode.');
      const secret = await vscode.window.showInputBox({ title: 'Pair Agent Mode', prompt: 'Enter the one-time bootstrap secret shown by the local brain operator.', password: true, ignoreFocusOut: true });
      if (!secret) return;
      try { await ensureAgentAuthorization(root, secret, 'pairing'); void vscode.window.showInformationMessage('Agent Mode paired for this extension activation and workspace.'); }
      catch { void vscode.window.showErrorMessage('Agent Mode pairing was refused or expired.'); }
    }),
  );

  // ── MigraPilot Shell — the redesigned command centre ───────────────────────
  //
  // One authoritative state drives two surfaces:
  //   * `migrapilot.sidebar`  → the left navigation region;
  //   * the Studio editor panel → header, tabs, chat, proposals, run evidence
  //     and the right-hand context panel.
  //
  // It reuses the SAME backend pipeline as the chat participant and the SAME
  // Agent Mode endpoints as the existing approval view; it introduces no new
  // execution path and never touches the Brain lifecycle.
  shell = new MigraPilotShell({
    brainClient,
    router,
    migraAiClient,
    engineDiagnostics,
    // Governs chat turns. Bootstrap ran at activation and its recovery is already
    // persisted by the time this executes, so a turn can never start before the store
    // is consistent.
    ...(brainBootstrap?.store ? { brainStore: brainBootstrap.store } : {}),
    memoryMode: () => {
      const m = String(vscode.workspace.getConfiguration('migrapilot').get('memoryMode', 'session'));
      return m === 'off' || m === 'durable' ? m : 'session';
    },
    executionPolicy: () => policyState.get(),
    workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    authorizeWorkspace: (root) => ensureAgentAuthorization(root),
    memento: context.workspaceState,
    output: outputChannel,
    onAgentMode: (enabled, state) => {
      agentModeStatusBar.text = agentModeStatusText(enabled, state);
    },
    workspaceController: () => workspaceController,
    revealStudio: (tab) => studioPanel.reveal(tab),
    extensionUri: context.extensionUri,
  });
  studioPanel = new MigraPilotStudioPanel(context.extensionUri, shell);
  sidebar = new MigraPilotSidebarProvider(shell);
  context.subscriptions.push(
    { dispose: () => studioPanel.dispose() },
    vscode.window.registerWebviewViewProvider(MigraPilotSidebarProvider.viewType, sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('migrapilot.openStudio', async (tab?: string) =>
      studioPanel.reveal(isShellTabArg(tab) ? tab : undefined),
    ),
    // Keep the active editor reflected in the shell's context-files panel.
    vscode.window.onDidChangeActiveTextEditor(() => void shell.refresh()),
  );

  // Legacy dedicated chat view — PRESERVED. `migrapilot.chatView` stays
  // registered and fully functional (its own webview, same backend pipeline), so
  // no existing workflow or focus command is lost by the redesign.
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
    // `migrapilot.openChat` opens the canonical Command Center chat surface.
    vscode.commands.registerCommand('migrapilot.openChat', async () => {
      await studioPanel.reveal('chat');
    }),
    // Governed coding change. The only command that can cause a repository write,
    // and it does so only after one scope approval bound to a hashed path set.
    governedCoding.disposable,
    // Developer-only escape hatches for the superseded views. They are hidden
    // from the Command Palette unless `migrapilot.enableClassicViews` is on
    // (package.json `menus.commandPalette`), and they refuse rather than fail
    // obscurely when invoked while the setting is off — a non-contributed view
    // cannot be focused, so the setting is the single real gate.
    vscode.commands.registerCommand('migrapilot.dev.openClassicChat', async () => {
      if (!requireClassicViews('Chat (Classic)')) return;
      await vscode.commands.executeCommand('migrapilot.chatView.focus');
      chatView.reveal();
    }),
    vscode.commands.registerCommand('migrapilot.dev.openClassicAgentMode', async () => {
      if (!requireClassicViews('Agent Mode (Classic)')) return;
      await agentModeView.reveal();
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
    // PRESERVED command id, re-pointed to the canonical surface: the Command
    // Center's Workspace tab is now the one MigraAI Workspace surface, so this
    // command can never target a view that is hidden by default.
    vscode.commands.registerCommand('migrapilot.openWorkspacePanel', async () => {
      await studioPanel.reveal('workspace');
    }),
    vscode.commands.registerCommand('migrapilot.dev.openClassicWorkspace', async () => {
      if (!requireClassicViews('MigraAI Workspace (Classic)')) return;
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
    // The first GOVERNED surface: an explicit user action that declares its capability
    // class. Read-only by construction — it explains a failure and cannot apply anything.
    vscode.commands.registerCommand('migrapilot.diagnoseFailure', () => runDiagnoseFailure(commandDeps)),
    vscode.commands.registerCommand('migrapilot.generateTests', () => runGenerateTestsCommand(testGenDeps)),
    vscode.commands.registerCommand('migrapilot.generateCommit', () => runGenerateCommitMessageCommand(testGenDeps)),
    vscode.commands.registerCommand('migrapilot.setToken', setToken),
    vscode.commands.registerCommand('migrapilot.clearToken', clearToken),
    vscode.commands.registerCommand('migrapilot.reviewApprovals', () => runReviewApprovals(commandDeps)),
    vscode.commands.registerCommand('migrapilot.runCommand', () =>
      runAdHocCommand(commandDeps, context.workspaceState),
    ),
    vscode.commands.registerCommand('migrapilot.quickEdit', () => runQuickEdit(commandDeps)),
    vscode.commands.registerCommand('migrapilot.gitOverview', () => runGitOverview(commandDeps)),
    vscode.commands.registerCommand('migrapilot.runTests', () =>
      // Verification is a RESULT, so it is reflected in the product surface, not
      // only in an output channel the user has to go looking for.
      runTests(commandDeps, context.workspaceState, undefined, (summary) =>
        shell?.recordActivity(summary.text, summary.tone),
      ),
    ),
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
  output('MigraPilot extension activated.');

  return {
    interactionCorrelations: (limit?: number) => recentCorrelations(limit),
    router,
    resolveBackend,
    setToken: (token: string) => tokenStore.set(token),
    clearToken: () => tokenStore.delete(),
    approvals: new ApprovalsClient(pilotClient),
    renderConsent: async (actionId: string) => {
      const action = await new ApprovalsClient(pilotClient).get(actionId);
      return action.change ? renderActionConsent(action.change) : '';
    },
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
    shell: {
      state: () => shell.currentState(),
      loadTab: (tab: string) => (isShellTabArg(tab) ? shell.loadTab(tab) : Promise.resolve()),
      workspaceIntent: (intent: string) => shell.runWorkspaceIntentForTest(intent),
    },
    classicViews: {
      enabled: classicViewsEnabled,
      chatResolved: () => chatView.wasResolved(),
      agentModeResolved: () => agentModeView.wasResolved(),
    },
    backendDiagnostics: () => diagnostics.snapshot(),
    engineDiagnostics: () => engineDiagnostics.snapshot(),
    governedCoding: {
      /** Exposed for installed-path acceptance; asks the Brain, never infers. */
      restore: () => restoreGovernedCodingRun(context, codingRunClient, (message) => output(message)),
      client: () => codingRunClient,
      /** Supply a scripted interaction sequence. Used ONLY by the packaged
       * acceptance; production never calls it, and it injects user RESPONSES —
       * never the client, workspace, snapshots or completion state. */
      setUi: (factory) => governedCoding.uiHolder.set(factory),
    },
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
  shell?.recordActivity(
    `Backend resolved: ${resolved.kind === 'remote' ? 'pilot-api' : resolved.kind === 'remote-unavailable' ? 'pilot-api unavailable' : 'local brain-service'}`,
    resolved.kind === 'remote-unavailable' ? 'warn' : 'info',
  );
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

export async function deactivate(): Promise<void> {
  // Kill ONLY the brain process this extension started (adopted brains untouched).
  await brainLifecycle?.shutdown();
  output('MigraPilot extension deactivated.');
}

async function checkHealth(): Promise<void> {
  // Qualified-intelligence availability is reported alongside runtime health because the two
  // failures look identical to a user otherwise: a healthy Brain with nothing qualified is
  // NOT a usable estate, and must not be presented as one.
  const capabilityLine = capabilityStatusLine();
  output(capabilityLine);
  try {
    const health = await brainClient.health();
    const message = `MigraPilot Brain Service is ${health.status}. Version ${health.version}. Uptime ${health.uptimeSec}s. ${capabilityLine}`;
    output(message);
    shell?.recordActivity(`Health check: Brain Service ${health.status}`, health.status === 'ok' ? 'ok' : 'warn');
    void vscode.window.showInformationMessage(message, 'Show Logs');
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

/** Engineering surfaces are revealed only by explicit opt-in. Default: off. */
function developerModeEnabled(): boolean {
  return vscode.workspace.getConfiguration('migrapilot').get<boolean>('developerMode', false) === true;
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
    void vscode.window.showErrorMessage(formatError('Could not load execution policies from the engine', error));
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
  void vscode.window.showInformationMessage(`${label}. This is a per-request preference — the engine resolves the effective policy and enforces routing, consent, privacy, and budget.`);
}

/** Read-only provider status (Slice 5). Shows the fleet without credential values. */
async function showProviderStatus(): Promise<void> {
  try {
    const { providers } = await routerClient.getProviders();
    const items = providerRows(providers).map((r) => ({ label: `${r.name} · ${r.type}`, description: `${r.health}${r.note ? ` — ${r.note}` : ''}`, detail: `Capabilities: ${r.capabilities}${r.model ? ` · Model: ${r.model}` : ''}` }));
    await vscode.window.showQuickPick(items, { title: 'MigraPilot — Providers (read-only)', placeHolder: 'Provider status. No credentials or endpoints are shown.' });
  } catch (error) {
    void vscode.window.showErrorMessage(formatError('Could not load provider status', error));
  }
}

/** Read-only AI usage + budget (Slice 5). */
async function showAiUsage(): Promise<void> {
  try {
    const [budget, usage] = await Promise.all([routerClient.getBudget(), routerClient.getUsage({ limit: 1 })]);
    const rows = budgetRows(budget, usage).map((r) => `${r.label}: ${r.value}`);
    void vscode.window.showInformationMessage(`AI Usage — ${rows.join(' · ')}`, 'OK');
  } catch (error) {
    void vscode.window.showErrorMessage(formatError('Could not load AI usage', error));
  }
}

/** Read-Only Production Diagnostics status (Slice 5). Surfaces the brain's
 * dedicated production-diagnostics provider status, clearly labeled read-only.
 * This command NEVER mutates production; it only reads the provider's status. */
async function productionDiagnosticsStatus(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('migrapilot');
  const base = String(cfg.get('brainUrl', 'http://127.0.0.1:3988'));
  try {
    // Governed: `base` is migrapilot.brainUrl, so this IS Brain traffic and goes
      // through the approved transport for the same timeout, cancellation and
      // structured failure classification. Read-only — never a mutation.
      const outcome = await callBrainTool<undefined, {
        mode?: string; enabled?: boolean; targetCount?: number; capabilityCount?: number;
      }>(base, '/api/ai/production-diagnostics/status', undefined, { method: 'GET' });
      if (!outcome.ok || !outcome.value) throw new Error(outcome.statusLine);
    const s = outcome.value;
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
    void vscode.window.showErrorMessage(message);
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
