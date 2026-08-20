// MigraPilot Shell — extension-host provider.
//
// Owns the message protocol, the canonical data collection, and the Agent Mode
// lifecycle for the redesigned command centre. It can drive MORE THAN ONE
// webview (the Studio editor panel and a sidebar view) from one authoritative
// state, so both surfaces always agree.
//
// SECURITY BOUNDARIES (§1) enforced in this file:
//
//  * Agent Mode gate — every propose/decide/cancel path checks
//    `gate.enabled` first. Entering the mode is an explicit operator action;
//    nothing in the webview can bypass it.
//  * Approval binding — the preview FINGERPRINT never leaves the host. The
//    webview posts a bare `approve` / `reject` intent; the host binds the
//    decision to the fingerprint it holds from authoritative server state.
//  * History is evidence — history intents can only read or export evidence.
//    There is no host handler that could approve, resume, or execute from a
//    history record.
//  * Command dispatch — the webview can only trigger commands on an explicit
//    allow-list of already-registered `migrapilot.*` commands.
//  * Brain lifecycle — untouched. The shell reads `/health`; it never starts,
//    stops, or restarts the service.

import * as vscode from 'vscode';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { AgentModeCommandRunView, AgentModeRunHistoryDetail, AgentModeRunHistoryList } from '@migrapilot/protocol';
import type { ChatAttachment } from '@migrapilot/shared-types';
import { isPilotError } from '@migrapilot/pilot-client';
import { type ChatSink, type SelectableProfile, runChatTurn, summarizeTurns } from '../../chat/chatEngine.js';
import { type GitResult, type GitRunner, assertReadOnly } from '../../commitGen/git.js';
import { BrainClient } from '../../services/brainClient.js';
import type { BackendRouter } from '../../services/backendRouter.js';
import type { EngineDiagnostics } from '../../services/engineDiagnostics.js';
import type { BrainStore } from '../../services/brainPersistence.js';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { readGitContext, readWorkingChanges } from '../../services/gitContext.js';
import { groundingModeOf, liveModeConfirmation, liveModeOf, sourceModeConfirmation } from './composerModel.js';
import type { GovernedWorkflow } from '../../capability/workflowClassification.js';
import { AgentModeSessionGate } from '../agentModeModel.js';
import { ActivityRecorder, type ContextFileEntry, type GitContextSnapshot } from './contextPanelModel.js';
import { navigationHtml } from './navigationHtml.js';
import { findNavAction, isShellTab, resolveTab, type ShellTabId } from './navigationModel.js';
import { approvalConsentDetail, toProposalCard } from './proposalCardModel.js';
import { toEvidenceExportSummary } from './runHistoryModel.js';
import { shellHtml } from './shellHtml.js';
import { shellScript } from './shellScript.js';
import { buildShellState, type ShellState, type ShellStateInput, type WorkingChange } from './shellState.js';
import type { WorkspaceController } from '../workspaceController.js';
import type { WorkspacePanelModel } from '../workspaceViewModel.js';
import {
  approveWorkspaceIndex,
  changeWorkspaceMemory,
  deleteWorkspace,
  openWorkspace,
  rebuildWorkspace,
  refreshWorkspace,
  showWorkspaceDiagnostics,
  syncWorkspace,
  type WorkspaceActionDeps,
} from './workspaceActions.js';
import { isWorkspaceIntent, type WorkspaceIntent } from './workspaceTabModel.js';
import { findWelcomeAction, resolveWelcomeEffect } from './welcomeModel.js';
import { classify, isProductSurface } from './surfaceClassification.js';
import type { Row } from './types.js';

/** Commands the webview may dispatch. Every entry is an EXISTING registered
 * command; the shell adds no new execution surface. */
/**
 * Commands the shell may dispatch.
 *
 * Derived from the locked classification rather than hand-listed, because the two
 * had already drifted: the hand-written set carried eight diagnostics commands and
 * none of the lanes a user actually needs, so a `Run tests` card would have been
 * refused by its own host and shipped as a dead button.
 *
 * `dispatchCommand` additionally refuses anything outside the product classes when
 * developer mode is off, so a webview message cannot reach an engineering command
 * that the interface deliberately does not offer.
 */
function isDispatchableCommand(command: string): boolean {
  return classify('command', command) !== undefined;
}

const CONVERSATION_KEY = 'migrapilot.activeConversationId';
const ACTIVE_RUN_KEY = 'migrapilot.shell.activeCommandRun';

/** Cap the attachment payload forwarded to the backend (base64 inflates ~33%). */
const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

const SELECTABLE_PROFILES: readonly SelectableProfile[] = ['cheap', 'default', 'premium'];

function toProfile(value: string | undefined): SelectableProfile | undefined {
  return SELECTABLE_PROFILES.includes(value as SelectableProfile) ? (value as SelectableProfile) : undefined;
}

function toAttachments(
  files: ReadonlyArray<{ name?: string; type?: string; dataUrl?: string; dataBase64?: string }> | undefined,
): ChatAttachment[] {
  if (!files?.length) return [];
  const out: ChatAttachment[] = [];
  let total = 0;
  for (const file of files) {
    const base64 = file.dataBase64 ?? (file.dataUrl ? file.dataUrl.slice(file.dataUrl.indexOf(',') + 1) : '');
    if (!base64) continue;
    const sizeBytes = Math.floor((base64.length * 3) / 4);
    if (total + sizeBytes > MAX_ATTACHMENT_BYTES) break;
    total += sizeBytes;
    out.push({ name: file.name ?? 'attachment', mimeType: file.type || 'application/octet-stream', dataBase64: base64, sizeBytes });
  }
  return out;
}

interface ChatMsg {
  role: string;
  text: string;
}

export interface ShellDeps {
  brainClient: BrainClient;
  router: BackendRouter;
  migraAiClient: MigraAiClient;
  engineDiagnostics?: EngineDiagnostics;
  /** Durable execution store. Absent until activation bootstrap resolves; a turn that
   * starts without it runs ungoverned and says so rather than faking a record. */
  brainStore?: BrainStore;
  memoryMode: () => 'off' | 'session' | 'durable';
  executionPolicy?: () => string;
  workspaceRoot: () => string | undefined;
  /** Server-issued Agent activation for a workspace. Never returns material the
   * shell could display — only the canonical workspace string. */
  authorizeWorkspace: (root: string) => Promise<string>;
  memento: vscode.Memento;
  output: vscode.OutputChannel;
  /** Reports the Agent Mode gate + state so the status bar stays accurate. */
  onAgentMode: (enabled: boolean, state: AgentModeCommandRunView['state'] | 'IDLE') => void;
  /** MigraAI Workspace controller — the SAME controller the standalone panel
   * uses, so the consolidated tab shares its authoritative semantics.
   *
   * A LAZY accessor, not the instance: the shell is constructed before the
   * controller is assigned during activation, so capturing the value directly
   * captures `undefined` and every workspace read fails with a confusing
   * "engine unreachable". Resolving on use makes construction order irrelevant. */
  workspaceController: () => WorkspaceController;
  /** Reveal the Studio editor panel (used when the sidebar asks for a tab). */
  revealStudio?: (tab: ShellTabId) => Promise<void>;
  extensionUri: vscode.Uri;
}

/** Read-only git runner, identical to the one used for commit generation. */
function realGitRunner(root: string): GitRunner {
  return {
    run: (args, signal) =>
      new Promise<GitResult>((resolve) => {
        assertReadOnly(args);
        const child = spawn('git', args, { cwd: root, signal });
        let stdout = '';
        child.stdout?.on('data', (chunk) => (stdout += chunk.toString()));
        child.on('close', (code) => resolve({ stdout, code: code ?? 1 }));
        child.on('error', () => resolve({ stdout: '', code: 1 }));
      }),
  };
}

export class MigraPilotShell {
  /** Full-shell surfaces (the Studio editor panel). */
  private readonly views = new Set<vscode.Webview>();
  /** Navigation-only surfaces (the sidebar view). */
  private readonly navViews = new Set<vscode.Webview>();
  private readonly gate = new AgentModeSessionGate();
  private readonly activity = new ActivityRecorder(20);

  private inFlight = false;
  private cts?: vscode.CancellationTokenSource;
  private savedMessages: ChatMsg[] = [];
  private conversationId?: string;
  private tab: ShellTabId = 'chat';

  /** Latest AUTHORITATIVE run view. The only source for approval binding. */
  private currentRun?: AgentModeCommandRunView;
  private history?: AgentModeRunHistoryList;
  private historyError?: { kind: 'activation' | 'transport'; message: string };
  private detail?: AgentModeRunHistoryDetail;
  private git?: GitContextSnapshot;
  private workingChanges?: WorkingChange[];
  private workingChangesError?: string;
  private brainHealth?: Awaited<ReturnType<BrainClient['healthDetail']>>;
  private brainError?: string;
  private conversations?: Awaited<ReturnType<MigraAiClient['listConversations']>>['conversations'];
  private conversationsError?: string;
  private modelCount?: number;
  private modelsError?: string;
  private attachmentNames: string[] = [];
  private refreshing = false;
  /** Authoritative MigraAI workspace model. Holds `workspaceId`/`indexVersion`,
   * which are NEVER posted to a webview — the host binds approvals itself. */
  private workspaceModel?: WorkspacePanelModel;
  private workspaceError?: string;
  /** Why the tab is empty when the engine IS reachable. */
  private workspaceEmptyReason?: string;
  private workspaceLoading = false;
  /** Serializes workspace lifecycle calls (same rationale as `agentBusy`). */
  private workspaceBusy = false;
  /** Serializes Agent Mode lifecycle calls. A double-click on Approve must not
   * produce two decision requests: the engine consumes the approval exactly
   * once, so the second would fail and only confuse the operator. */
  private agentBusy = false;

  constructor(private readonly deps: ShellDeps) {
    this.conversationId = deps.memento.get<string>(CONVERSATION_KEY);
  }

  // ── Webview attachment ─────────────────────────────────────────────────────

  /** Render the shell into a webview (editor panel or sidebar view) and wire the
   * message protocol. `compact` only hints at initial density; CSS decides. */
  attach(webview: vscode.Webview, opts: { compact: boolean }): vscode.Disposable {
    webview.options = { enableScripts: true, localResourceRoots: [this.deps.extensionUri] };
    webview.html = this.render(webview, opts.compact);
    this.views.add(webview);
    const subscription = webview.onDidReceiveMessage((message: unknown) => void this.onMessage(message, webview));
    return new vscode.Disposable(() => {
      subscription.dispose();
      this.views.delete(webview);
      if (this.views.size === 0) {
        // No surface is showing the shell — drop the explicit Agent Mode grant.
        this.gate.reset();
        this.deps.onAgentMode(false, 'IDLE');
      }
    });
  }

  /**
   * Render the navigation-only surface (the sidebar view) from the SAME state.
   * It shares the message protocol, so a conversation switch or a tool status
   * click behaves identically on either surface.
   */
  attachNavigation(webview: vscode.Webview): vscode.Disposable {
    webview.options = { enableScripts: true, localResourceRoots: [this.deps.extensionUri] };
    webview.html = this.renderNavigation(webview);
    this.navViews.add(webview);
    const subscription = webview.onDidReceiveMessage((message: unknown) => void this.onMessage(message, webview));
    return new vscode.Disposable(() => {
      subscription.dispose();
      this.navViews.delete(webview);
    });
  }

  private renderNavigation(webview: vscode.Webview): string {
    const nonce = randomBytes(18).toString('base64url');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data:`,
      "connect-src 'none'",
    ].join('; ');
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'resources', 'migrapilot-icon.svg'));
    return navigationHtml({ nonce, csp, logoUri: logo.toString() });
  }

  /** Focus the composer with a seeded prompt (used by commands routing to chat). */
  inject(text: string, submit = true): void {
    this.post({ type: 'injectMessage', text, submit });
  }

  /** Engineering surfaces are revealed only by explicit opt-in. Default: off. */
  private get developerMode(): boolean {
    return vscode.workspace.getConfiguration('migrapilot').get<boolean>('developerMode', false) === true;
  }

  showTab(tab: ShellTabId): void {
    // A tab the current mode does not render would leave the strip pointing at an
    // element that is not in the document, which reads as a blank product.
    tab = resolveTab(tab, this.developerMode);
    this.tab = tab;
    this.post({ type: 'tab', tab });
    // Revealing a tab must load its data on EVERY path. The webview only reports
    // `tabChanged` when the operator clicks the strip, so a tab revealed by a
    // command (`migrapilot.openStudio workspace`) would otherwise paint an
    // un-loaded empty state that looks like "nothing here".
    void this.loadForTab(tab);
  }

  /** The on-demand read each tab needs. Chat/agent render from state already. */
  private async loadForTab(tab: ShellTabId): Promise<void> {
    if (tab === 'audit') return this.loadHistory();
    if (tab === 'diff') return this.loadWorkingChanges();
    if (tab === 'workspace') return this.loadWorkspace();
  }

  private render(webview: vscode.Webview, compact: boolean): string {
    const nonce = randomBytes(18).toString('base64url');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `img-src ${webview.cspSource} data: blob:`,
      `font-src ${webview.cspSource}`,
      // Recording uses getUserMedia, which needs no connect-src; the audio is
      // relayed through the host, so the webview never reaches the network.
      "connect-src 'none'",
    ].join('; ');
    const logo = webview.asWebviewUri(vscode.Uri.joinPath(this.deps.extensionUri, 'resources', 'migrapilot-icon.svg'));
    return shellHtml({
      nonce,
      csp,
      logoUri: logo.toString(),
      initialTab: resolveTab(this.tab, this.developerMode),
      script: shellScript(this.developerMode),
      compact,
      developerMode: this.developerMode,
    });
  }

  private post(message: unknown): void {
    for (const view of this.views) void view.postMessage(message);
  }

  /** State is broadcast to BOTH surfaces; everything else is shell-only. */
  private postAll(message: unknown): void {
    for (const view of this.views) void view.postMessage(message);
    for (const view of this.navViews) void view.postMessage(message);
  }

  // ── Message protocol ───────────────────────────────────────────────────────

  private async onMessage(raw: unknown, webview: vscode.Webview): Promise<void> {
    const message = (raw ?? {}) as {
      type?: string;
      text?: string;
      tab?: string;
      action?: string;
      command?: string;
      intent?: string;
      recipe?: string;
      id?: string;
      runId?: string;
      audio?: string;
      mime?: string;
      level?: string;
      provider?: string;
      modelId?: string;
    /** Evidence-source selection from the composer (`auto` | `approved`). */
    sourceMode?: string;
    /** Live-knowledge selection from the composer (`off` | `official` | `web`). */
    liveMode?: string;
      submit?: boolean;
      history?: ChatMsg[];
      messages?: ChatMsg[];
      files?: Array<{ name?: string; type?: string; dataUrl?: string; kind?: string }>;
    };

    switch (message.type) {
      case 'ready':
        await this.onReady(webview);
        return;
      case 'saveState':
        this.savedMessages = message.messages ?? [];
        return;
      case 'tabChanged':
        if (isShellTab(message.tab)) {
          this.tab = message.tab;
          // Opening the evidence surface reads history on demand.
          if (message.tab === 'audit') await this.loadHistory();
          if (message.tab === 'diff') await this.loadWorkingChanges();
          if (message.tab === 'workspace') await this.loadWorkspace();
        }
        return;
      case 'openTab':
        // Sent by the sidebar, which has no tab strip: reveal the Studio panel.
        if (isShellTab(message.tab)) {
          this.tab = message.tab;
          await this.deps.revealStudio?.(message.tab);
          this.showTab(message.tab);
          if (message.tab === 'audit') await this.loadHistory();
          if (message.tab === 'diff') await this.loadWorkingChanges();
          if (message.tab === 'workspace') await this.loadWorkspace();
        }
        return;
      case 'chat':
        await this.handleChat(
          message.text ?? '',
          message.history ?? [],
          toProfile(message.provider),
          toAttachments(message.files),
          typeof message.modelId === 'string' && message.modelId ? message.modelId : undefined,
          // Explicit evidence-source selection from the composer. The webview may
          // send it per turn; the host's sticky value is the fallback so a mode set
          // via `/approved` survives until it is changed.
          typeof message.sourceMode === 'string' ? message.sourceMode : this.sourceMode,
          // The second dimension, carried separately. A single combined field would
          // make it impossible to say "no repository evidence AND official sources",
          // which is a legitimate and useful combination.
          typeof message.liveMode === 'string' ? message.liveMode : this.liveMode,
        );
        return;
      case 'stop':
        this.cts?.cancel();
        return;
      case 'attachmentsChanged':
        this.attachmentNames = (message.files ?? []).map((file) => file.name ?? 'attachment');
        await this.publish();
        return;
      case 'selectConversation':
        await this.selectConversation(message.id);
        return;
      case 'headerAction':
        await this.onHeaderAction(message.action);
        return;
      case 'navAction':
        await this.onNavAction(message.action);
        return;
      case 'shellAction':
        await this.onShellAction(message.action);
        return;
      case 'welcomeAction':
        await this.onWelcomeAction(message.action);
        return;
      case 'command':
        await this.dispatchCommand(message.command);
        return;
      case 'proposeRecipe':
        await this.propose(message.recipe);
        return;
      case 'agentIntent':
        await this.onAgentIntent(message.intent);
        return;
      case 'workspaceIntent':
        await this.onWorkspaceIntent(message.intent);
        return;
      case 'selectHistoryRun':
        await this.loadRunDetail(message.runId);
        return;
      case 'evidenceAction':
        await this.onEvidenceAction(message.action, message.runId);
        return;
      case 'transcribe':
        await this.transcribe(message.audio, message.mime);
        return;
      case 'info':
        if (message.text) void vscode.window.showInformationMessage(message.text.slice(0, 400));
        return;
      default:
        return;
    }
  }

  private async onReady(webview: vscode.Webview): Promise<void> {
    if (this.conversationId && this.deps.memoryMode() !== 'off') {
      await this.reloadAuthoritativeHistory();
    } else if (this.savedMessages.length) {
      void webview.postMessage({ type: 'restore', messages: this.savedMessages });
    }
    await this.refresh();
    void this.postModelCatalog();
    const storedRun = this.deps.memento.get<string>(ACTIVE_RUN_KEY);
    if (storedRun && this.gate.enabled) await this.reconcile(storedRun);
  }

  // ── Canonical data collection ──────────────────────────────────────────────

  /** Re-read every canonical source and publish one authoritative state. Each
   * read is independently guarded so one outage degrades one panel (§14). */
  async refresh(): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;
    try {
      await Promise.all([this.loadHealth(), this.loadGit(), this.loadConversations(), this.loadModels()]);
    } finally {
      this.refreshing = false;
    }
    await this.publish();
  }

  private async loadHealth(): Promise<void> {
    try {
      this.brainHealth = await this.deps.brainClient.healthDetail();
      this.brainError = undefined;
    } catch (error) {
      this.brainHealth = undefined;
      this.brainError = 'The Brain service is unreachable. Repair the connection or check the service.';
      this.deps.output.appendLine(`[shell] health unavailable: ${this.reason(error)}`);
    }
  }

  private async loadGit(): Promise<void> {
    const root = this.deps.workspaceRoot();
    if (!root) {
      this.git = { unavailableReason: 'No workspace folder is open.' };
      return;
    }
    this.git = await readGitContext(realGitRunner(root), root);
  }

  /**
   * The live checkout branch, or undefined when it cannot be determined.
   *
   * Undefined is meaningful: the Brain treats a missing branch as UNKNOWN and will
   * not claim the index and checkout agree. Never guess a branch here.
   */
  private async currentBranch(): Promise<string | undefined> {
    if (this.git?.branch) return this.git.branch;
    const root = this.deps.workspaceRoot();
    if (!root) return undefined;
    try {
      const snapshot = await readGitContext(realGitRunner(root), root);
      this.git = snapshot;
      return snapshot.branch;
    } catch {
      return undefined; // unknown, not "same"
    }
  }

  private async loadWorkingChanges(): Promise<void> {
    const root = this.deps.workspaceRoot();
    if (!root) {
      this.workingChanges = [];
      this.workingChangesError = 'No workspace folder is open.';
      await this.publish();
      return;
    }
    try {
      this.workingChanges = await readWorkingChanges(realGitRunner(root));
      this.workingChangesError = undefined;
    } catch (error) {
      this.workingChanges = undefined;
      this.workingChangesError = 'Working-tree changes could not be read.';
      this.deps.output.appendLine(`[shell] working changes unavailable: ${this.reason(error)}`);
    }
    await this.publish();
  }

  private async loadConversations(): Promise<void> {
    if (this.deps.memoryMode() === 'off') {
      this.conversations = [];
      this.conversationsError = undefined;
      return;
    }
    try {
      const { conversations } = await this.deps.migraAiClient.listConversations();
      this.conversations = conversations;
      this.conversationsError = undefined;
    } catch (error) {
      this.conversations = undefined;
      this.conversationsError = 'Conversation history is unavailable while the engine is unreachable.';
      this.deps.output.appendLine(`[shell] conversations unavailable: ${this.reason(error)}`);
    }
  }

  private async loadModels(): Promise<void> {
    try {
      const { models } = await this.deps.migraAiClient.getModels();
      this.modelCount = models.filter((model) => model.capabilities?.chat !== false).length;
      this.modelsError = undefined;
    } catch (error) {
      this.modelCount = undefined;
      this.modelsError = 'The engine model catalogue is unavailable.';
      this.deps.output.appendLine(`[shell] models unavailable: ${this.reason(error)}`);
    }
  }

  /** History requires a valid activation — an unactivated workspace reports
   * `activation-required`, never an empty list that would read as "no runs". */
  private async loadHistory(): Promise<void> {
    if (!this.deps.migraAiClient.agentActivationStatus().valid) {
      this.history = undefined;
      this.historyError = {
        kind: 'activation',
        message: 'A valid Agent Mode activation is required to read run history for this workspace.',
      };
      await this.publish();
      return;
    }
    try {
      this.history = await this.deps.migraAiClient.listAgentModeRunHistory({ limit: 25 });
      this.historyError = undefined;
    } catch (error) {
      this.history = undefined;
      this.historyError = { kind: 'transport', message: 'Run history could not be read from the engine.' };
      this.deps.output.appendLine(`[shell] history unavailable: ${this.reason(error)}`);
    }
    await this.publish();
  }

  private async loadRunDetail(runId: string | undefined): Promise<void> {
    if (!runId) return;
    try {
      this.detail = await this.deps.migraAiClient.getAgentModeRunHistory(runId);
      this.showTab('audit');
    } catch (error) {
      this.detail = undefined;
      this.notice('Run evidence could not be read from the engine.', 'warn');
      this.deps.output.appendLine(`[shell] run detail unavailable: ${this.reason(error)}`);
    }
    await this.publish();
  }

  // ── MigraAI Workspace (consolidated tab) ───────────────────────────────────

  /** Deps for the shared action orchestrator. */
  private workspaceDeps(): WorkspaceActionDeps {
    return {
      controller: this.deps.workspaceController(),
      notice: (text, level) => this.notice(text, level),
      output: this.deps.output,
    };
  }

  /**
   * Read authoritative workspace state.
   *
   * Only ever REFRESHES a workspace that is already open — it never registers
   * one implicitly, because opening is an explicit operator action that can
   * choose a root.
   */
  private async loadWorkspace(): Promise<void> {
    if (!this.workspaceModel) {
      // Nothing open in this session; adopt an already-registered workspace for
      // the active root if the engine knows one, otherwise stay empty.
      this.workspaceLoading = true;
      await this.publish();
      try {
        const summaries = await this.deps.workspaceController().list();
        const root = this.deps.workspaceRoot();
        const match = root ? summaries.find((summary) => summary.root === root) : undefined;
        this.workspaceModel = match ? await this.deps.workspaceController().get(match.id) : undefined;
        // Distinguish "the engine has nothing for THIS root" from "the engine is
        // unreachable" — the operator needs to know which, because only one of
        // them is fixed by Repair Connection.
        this.workspaceError = undefined;
        this.workspaceEmptyReason = match
          ? undefined
          : !root
            ? 'No folder is open in VS Code, so there is no workspace to register.'
            : summaries.length === 0
              ? 'The engine has no registered workspace yet. Open Workspace registers this folder and builds its semantic index.'
              : `The engine has ${summaries.length} registered workspace(s), but none for this folder. Open Workspace registers it.`;
      } catch (error) {
        this.workspaceModel = undefined;
        this.workspaceEmptyReason = undefined;
        // Include the bounded engine reason: "could not be reached" is unhelpful
        // when the real cause is a refused request, and it sends the operator to
        // Repair Connection for a problem that is not connectivity.
        this.workspaceError = `Workspace state could not be read from the MigraAI engine — ${this.reason(error)}`;
        this.deps.output.appendLine(`[shell workspace] list/get failed: ${this.reason(error)}`);
      } finally {
        this.workspaceLoading = false;
      }
      await this.publish();
      return;
    }
    const result = await refreshWorkspace(this.workspaceDeps(), this.workspaceModel);
    this.applyWorkspaceResult(result.model);
    await this.publish();
  }

  /**
   * Workspace lifecycle dispatch.
   *
   * The webview posts a BARE intent. The workspace id and — critically — the
   * index version come from host-held authoritative state, so an approval is
   * always bound to the version the operator actually reviewed.
   */
  private async onWorkspaceIntent(intent: string | undefined): Promise<void> {
    if (!isWorkspaceIntent(intent)) {
      this.deps.output.appendLine(`[shell workspace] refused unknown intent: ${intent ?? '(none)'}`);
      return;
    }
    if (this.workspaceBusy) {
      this.deps.output.appendLine(`[shell workspace] ignored duplicate ${intent} while a lifecycle call is in flight`);
      return;
    }
    this.workspaceBusy = true;
    try {
      await this.runWorkspaceIntent(intent);
    } catch (error) {
      this.notice('The MigraAI engine could not complete the workspace request.', 'error');
      this.deps.output.appendLine(`[shell workspace] ${intent} failed: ${this.reason(error)}`);
    } finally {
      this.workspaceBusy = false;
      await this.publish();
    }
  }

  private async runWorkspaceIntent(intent: WorkspaceIntent): Promise<void> {
    const deps = this.workspaceDeps();
    // A successful call proves reachability, so any stale transport error from an
    // earlier read is cleared by `applyWorkspaceResult` below.

    if (intent === 'open') {
      const result = await openWorkspace(deps);
      if (result.model) {
        this.applyWorkspaceResult(result.model);
        this.activity.record(`Workspace opened: ${result.model.name}`, 'ok', Date.now());
      }
      return;
    }
    if (intent === 'diagnostics') {
      await showWorkspaceDiagnostics(deps, this.workspaceModel);
      return;
    }
    if (intent === 'refreshWorkspace') {
      await this.loadWorkspace();
      return;
    }

    const current = this.workspaceModel;
    if (!current) {
      this.notice('Open a workspace before running this action.', 'warn');
      return;
    }

    switch (intent) {
      case 'sync': {
        const result = await syncWorkspace(deps, current);
        this.applyWorkspaceResult(result.model);
        if (!result.cancelled) this.activity.record('Workspace index synced', 'info', Date.now());
        return;
      }
      case 'rebuild': {
        const result = await rebuildWorkspace(deps, current);
        this.applyWorkspaceResult(result.model);
        if (!result.cancelled) this.activity.record('Workspace index rebuilt — approval required', 'warn', Date.now());
        return;
      }
      case 'approve': {
        const result = await approveWorkspaceIndex(deps, current);
        this.applyWorkspaceResult(result.model);
        if (!result.cancelled) this.activity.record('Semantic index approved', 'ok', Date.now());
        return;
      }
      case 'changeMemory': {
        const result = await changeWorkspaceMemory(deps, current);
        this.applyWorkspaceResult(result.model);
        return;
      }
      case 'delete': {
        const result = await deleteWorkspace(deps, current);
        this.applyWorkspaceResult(result.model);
        if (!result.model && !result.cancelled) this.activity.record('Workspace registration deleted', 'warn', Date.now());
        return;
      }
      default:
        return;
    }
  }

  /**
   * Record a workspace result and clear any STALE read failure.
   *
   * Reaching this point means a controller call completed, which proves the
   * engine is reachable — so a previous transport error must not survive and
   * keep the tab pinned to "unreachable".
   */
  private applyWorkspaceResult(model: WorkspacePanelModel | undefined): void {
    this.workspaceModel = model;
    this.workspaceError = undefined;
    if (model) this.workspaceEmptyReason = undefined;
  }

  /** Files currently in context. Derived from the real active editor and the
   * real staged attachments — never a speculative list. */
  private contextFiles(): ContextFileEntry[] {
    const entries: ContextFileEntry[] = [];
    const editor = vscode.window.activeTextEditor;
    const root = this.deps.workspaceRoot();
    if (editor && editor.document.uri.scheme === 'file') {
      const path = root ? vscode.workspace.asRelativePath(editor.document.uri, false) : editor.document.fileName;
      entries.push({ path, kind: 'active-editor', reason: 'open in the active editor' });
    }
    for (const name of this.attachmentNames) {
      entries.push({ path: name, kind: 'attachment', reason: 'attached to the next turn' });
    }
    return entries;
  }

  private stateInput(): ShellStateInput {
    const activation = this.deps.migraAiClient.agentActivationStatus();
    const workspaceRoot = this.deps.workspaceRoot();
    const historySummary = this.currentRun
      ? this.history?.runs.find((run) => run.runId === this.currentRun?.runId)
      : undefined;
    return {
      now: Date.now(),
      tab: this.tab,
      developerMode: this.developerMode,
      brainEndpoint: this.deps.brainClient.baseUrl,
      ...(this.brainHealth ? { brainHealth: this.brainHealth } : {}),
      ...(this.brainError ? { brainError: this.brainError } : {}),
      ...(this.git ? { git: this.git } : {}),
      ...(workspaceRoot ? { workspaceName: vscode.workspace.workspaceFolders?.[0]?.name ?? undefined } : {}),
      ...(this.conversations ? { conversations: this.conversations } : {}),
      ...(this.conversationsError ? { conversationsError: this.conversationsError } : {}),
      ...(this.conversationId ? { activeConversationId: this.conversationId } : {}),
      ...(this.modelCount !== undefined ? { modelCount: this.modelCount } : {}),
      ...(this.modelsError ? { modelsError: this.modelsError } : {}),
      ...(this.deps.executionPolicy ? { policy: this.deps.executionPolicy() } : {}),
      agentModeActive: this.gate.enabled,
      // STATUS ONLY — the workspace is reduced to a folder label.
      activation: {
        valid: activation.valid,
        ...(activation.canonicalWorkspace ? { workspaceLabel: this.folderLabel(activation.canonicalWorkspace) } : {}),
        ...(activation.allowedRecipes ? { allowedRecipes: activation.allowedRecipes } : {}),
        ...(activation.expiresAt ? { expiresAt: activation.expiresAt } : {}),
      },
      ...(this.currentRun ? { activeRun: this.currentRun } : {}),
      ...(this.detail && this.currentRun && this.detail.summary.runId === this.currentRun.runId
        ? { activeRunTimeline: this.detail.timeline }
        : {}),
      ...(historySummary
        ? { activeRunIntegrity: { integrity: historySummary.integrity, issues: historySummary.integrityIssues } }
        : {}),
      ...(this.history ? { history: this.history } : {}),
      ...(this.historyError ? { historyError: this.historyError } : {}),
      ...(this.detail ? { detail: this.detail } : {}),
      ...(this.workingChanges ? { workingChanges: this.workingChanges } : {}),
      ...(this.workingChangesError ? { workingChangesError: this.workingChangesError } : {}),
      ...(this.workspaceModel ? { workspaceModel: this.workspaceModel } : {}),
      ...(this.workspaceError ? { workspaceError: this.workspaceError } : {}),
      ...(this.workspaceEmptyReason ? { workspaceEmptyReason: this.workspaceEmptyReason } : {}),
      ...(this.workspaceLoading ? { workspaceLoading: true } : {}),
      contextFiles: this.contextFiles(),
      activity: this.activity.list(),
      voiceSupported: this.voiceSupported(),
    };
  }

  private folderLabel(value: string): string {
    const segments = value.replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean);
    return segments.length ? segments[segments.length - 1]! : value;
  }

  private voiceSupported(): boolean {
    const url = String(vscode.workspace.getConfiguration('migrapilot').get('transcribeUrl', ''));
    return url.trim().length > 0;
  }

  private buildState(): ShellState {
    return buildShellState(this.stateInput());
  }

  private async publish(): Promise<void> {
    this.postAll({ type: 'state', state: this.buildState() });
  }

  private notice(text: string, level: 'info' | 'warn' | 'error'): void {
    this.post({ type: 'notice', text: text.slice(0, 300), level });
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  private async ensureConversation(mode: 'session' | 'durable'): Promise<string | undefined> {
    if (this.conversationId) return this.conversationId;
    try {
      const conversation = await this.deps.migraAiClient.createConversation({ memoryMode: mode });
      this.conversationId = conversation.id;
      await this.deps.memento.update(CONVERSATION_KEY, conversation.id);
      return conversation.id;
    } catch (error) {
      this.deps.output.appendLine(`[shell] createConversation failed: ${this.reason(error)}`);
      this.notice('Memory is unavailable — this turn is stateless.', 'warn');
      return undefined;
    }
  }

  private async reloadAuthoritativeHistory(): Promise<void> {
    if (!this.conversationId) return;
    try {
      const { messages } = await this.deps.migraAiClient.getConversationMessages(this.conversationId);
      this.savedMessages = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({ role: message.role, text: message.content }));
      this.post({ type: 'restore', messages: this.savedMessages });
    } catch (error) {
      this.deps.output.appendLine(`[shell] reload history failed: ${this.reason(error)}`);
    }
  }

  /**
   * Evidence-source mode for subsequent turns (`auto` | `approved`).
   *
   * Host-side so it cannot be lost by a webview reload, and so an approved-only
   * session stays approved-only until the operator changes it — a governance mode
   * that silently reverted would be worse than not having one.
   */
  private sourceMode = 'auto';

  /**
   * Live-knowledge mode, sticky and host-side for the same reason as `sourceMode`.
   *
   * Defaults to `off`: network egress is never granted by default, and a webview reload
   * must not be able to turn it on.
   */
  private liveMode = 'off';

  private async handleChat(
    rawText: string,
    history: ChatMsg[],
    modelProfile: SelectableProfile | undefined,
    attachments: ChatAttachment[],
    modelId?: string,
    sourceMode?: string,
    liveMode?: string,
    /**
     * The host workflow for THIS turn, when one invoked it.
     *
     * Passed per call and never stored on the provider. `sourceMode` and `liveMode` are
     * sticky by design — an operator sets them and they persist — but a task class belongs
     * to one invocation: carrying it forward would let a Security Review workflow leave its
     * authority behind for the next ordinary question.
     */
    workflow?: GovernedWorkflow,
  ): Promise<void> {
    const text = rawText.trim();
    if (!text && attachments.length === 0) return;
    // Host-side duplicate guard — the webview has its own; a double dispatch
    // must never reach the backend.
    if (this.inFlight) {
      this.deps.output.appendLine('[shell] ignored duplicate chat request while a turn is active');
      return;
    }
    this.inFlight = true;
    this.cts = new vscode.CancellationTokenSource();
    this.post({ type: 'streamStart' });

    const sink: ChatSink = {
      progress: (value) => this.post({ type: 'statusUpdate', text: value }),
      markdown: (value) => this.post({ type: 'token', text: value }),
    };

    const mode = this.deps.memoryMode();
    const conversationId = mode === 'off' ? undefined : await this.ensureConversation(mode);

    try {
      await runChatTurn(
        {
          brainClient: this.deps.brainClient,
          router: this.deps.router,
          migraAiClient: this.deps.migraAiClient,
          ...(this.deps.engineDiagnostics ? { engineDiagnostics: this.deps.engineDiagnostics } : {}),
          ...(this.deps.brainStore ? { brainStore: this.deps.brainStore } : {}),
        },
        sink,
        text || 'Analyze the attached file(s).',
        summarizeTurns(history),
        this.cts.token,
        {
          ...(modelProfile ? { modelProfile } : {}),
          ...(modelId ? { modelId } : {}),
          attachments,
          ...(this.deps.executionPolicy ? { policy: this.deps.executionPolicy() } : {}),
          ...(conversationId ? { conversationId, memoryPolicy: { mode, retrieve: true, store: true } } : {}),
          ...(sourceMode ? { sourceMode } : {}),
          ...(liveMode ? { liveMode } : {}),
          // Absent for ordinary chat, which the Brain resolves to `ungoverned`.
          ...(workflow ? { workflow } : {}),
          // The Brain treats a MISSING branch as unknown, never as "same branch",
          // so failing to resolve it degrades disclosure rather than faking it.
          ...(await this.currentBranch().then((b) => (b ? { currentBranch: b } : {}))),
        },
      );
      this.post({ type: 'streamEnd' });
    } catch (error) {
      const detail = this.reason(error);
      this.deps.output.appendLine(`[shell chat error] ${detail}`);
      this.post({ type: 'error', text: detail });
      this.post({ type: 'streamEnd' });
    } finally {
      this.inFlight = false;
      this.cts?.dispose();
      this.cts = undefined;
      this.attachmentNames = [];
      await this.loadConversations();
      await this.publish();
    }
  }

  private async postModelCatalog(): Promise<void> {
    try {
      const { models } = await this.deps.migraAiClient.getModels();
      const slim = models
        .filter((model) => model.capabilities?.chat !== false)
        .map((model) => ({
          id: model.id,
          tier: model.tier,
          paramCount: model.paramCount,
          state: model.qualification?.state,
          vision: Boolean(model.capabilities?.vision),
        }));
      this.post({ type: 'models', models: slim });
    } catch (error) {
      this.deps.output.appendLine(`[shell] model catalogue unavailable: ${this.reason(error)}`);
    }
  }

  private async selectConversation(id: string | undefined): Promise<void> {
    if (!id || id === this.conversationId) return;
    this.cts?.cancel();
    this.conversationId = id;
    await this.deps.memento.update(CONVERSATION_KEY, id);
    await this.reloadAuthoritativeHistory();
    await this.publish();
  }

  private async newConversation(): Promise<void> {
    this.cts?.cancel();
    this.savedMessages = [];
    this.conversationId = undefined;
    this.attachmentNames = [];
    await this.deps.memento.update(CONVERSATION_KEY, undefined);
    this.post({ type: 'newChat' });
    this.showTab('chat');
    await this.loadConversations();
    await this.publish();
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  private async onHeaderAction(action: string | undefined): Promise<void> {
    switch (action) {
      case 'newTask':
        this.showTab('agent');
        await this.publish();
        return;
      case 'agentMode':
        await this.toggleAgentMode();
        return;
      case 'audit':
        this.showTab('audit');
        await this.loadHistory();
        return;
      case 'runHistory':
        this.showTab('audit');
        await this.loadHistory();
        return;
      case 'settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'migrapilot');
        return;
      default:
        return;
    }
  }

  /**
   * Compact-launcher dispatch (§6).
   *
   * Anything involving a chat composer, an Agent Mode approval or a run-history
   * record REVEALS the Command Center on the right tab instead of rendering a
   * second surface in the sidebar. That is the mechanism that keeps exactly one
   * composer, one approval path and one history surface in the product.
   */
  private async onNavAction(id: string | undefined): Promise<void> {
    const action = id ? findNavAction(id) : undefined;
    if (!action) {
      this.deps.output.appendLine(`[shell] unknown navigation action: ${id ?? '(none)'}`);
      return;
    }
    if (action.kind === 'studio') {
      if (!isShellTab(action.target)) return;
      await this.deps.revealStudio?.(action.target);
      this.tab = action.target;
      this.showTab(action.target);
      if (action.target === 'audit') await this.loadHistory();
      if (action.target === 'diff') await this.loadWorkingChanges();
      await this.publish();
      return;
    }
    if (action.kind === 'command') {
      // Allow-list enforced in dispatchCommand — no new execution surface.
      await this.dispatchCommand(action.target);
      return;
    }
    await this.onShellAction(action.target);
  }

  private async onShellAction(action: string | undefined): Promise<void> {
    switch (action) {
      case 'newChat':
        // Starting a conversation from the sidebar brings the Studio forward.
        await this.deps.revealStudio?.('chat');
        await this.newConversation();
        return;
      case 'settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'migrapilot');
        return;
      case 'refreshContext':
        await this.refresh();
        return;
      case 'sourceMode:approved':
      case 'sourceMode:workspace':
      case 'sourceMode:none':
      case 'sourceMode:auto': {
        // Explicit, sticky operator choice — reported back so the UI and the user
        // both know which evidence source the next turn will be held to.
        this.sourceMode = groundingModeOf(action.slice('sourceMode:'.length));
        const branch = await this.currentBranch();
        this.post({ type: 'sourceMode', mode: this.sourceMode });
        this.post({
          type: 'token',
          text: `\n_${sourceModeConfirmation(this.sourceMode, branch)}_\n`,
        });
        return;
      }
      case 'liveMode:off':
      case 'liveMode:official':
      case 'liveMode:web': {
        // Sticky operator choice for the SECOND evidence dimension. Reported back so the
        // operator can see whether the next turn may reach the network, and confirmed in
        // words because a governance control nobody can describe back is not one they
        // can rely on.
        this.liveMode = liveModeOf(action.slice('liveMode:'.length));
        this.post({ type: 'liveMode', mode: this.liveMode });
        this.post({ type: 'token', text: `\n_${liveModeConfirmation(this.liveMode)}_\n` });
        return;
      }
      case 'refreshHistory':
        await this.loadHistory();
        return;
      case 'addContext':
        await this.addContextFiles();
        return;
      case 'enterAgentMode':
        await this.enterAgentMode();
        return;
      case 'openHistory':
        this.showTab('audit');
        await this.loadHistory();
        return;
      default:
        // Anything else is treated as a command id, allow-list enforced below.
        await this.dispatchCommand(action);
        return;
    }
  }

  private async onWelcomeAction(id: string | undefined): Promise<void> {
    const found = id ? findWelcomeAction(id) : undefined;
    if (!found) return;
    // "Explain code" with nothing selected must not dead-end on a warning toast, so
    // the host resolves the effect against the editor state it can actually see.
    const editor = vscode.window.activeTextEditor;
    const hasSelection = editor !== undefined && !editor.selection.isEmpty
      && editor.document.getText(editor.selection).trim().length > 0;
    const action = { ...found, effect: resolveWelcomeEffect(found.effect, { hasSelection }) };
    if (action.effect.kind === 'command') {
      await this.dispatchCommand(action.effect.command);
      return;
    }
    if (action.effect.kind === 'tab') {
      if (isShellTab(action.effect.tab)) {
        this.showTab(action.effect.tab);
        if (action.effect.tab === 'audit') await this.loadHistory();
        if (action.effect.tab === 'diff') await this.loadWorkingChanges();
      }
      return;
    }
    // A seeded prompt is placed in the composer WITHOUT auto-submitting, so the
    // operator always reviews what will be sent.
    this.showTab('chat');
    this.inject(action.effect.prompt, false);
  }

  private async dispatchCommand(command: string | undefined): Promise<void> {
    if (!command) return;
    if (!isDispatchableCommand(command)) {
      this.deps.output.appendLine(`[shell] refused unclassified command: ${command}`);
      return;
    }
    if (!this.developerMode && !isProductSurface('command', command)) {
      this.deps.output.appendLine(`[shell] refused engineering command in product mode: ${command}`);
      return;
    }
    await vscode.commands.executeCommand(`migrapilot.${command}`);
    await this.refresh();
  }

  private async addContextFiles(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: true,
      openLabel: 'Add to MigraPilot context',
      ...(this.deps.workspaceRoot() ? { defaultUri: vscode.Uri.file(this.deps.workspaceRoot()!) } : {}),
    });
    if (!picked?.length) return;
    for (const uri of picked) {
      this.attachmentNames.push(vscode.workspace.asRelativePath(uri, false));
    }
    this.notice(`${picked.length} file(s) added to the next turn's context.`, 'info');
    await this.publish();
  }

  // ── Agent Mode ─────────────────────────────────────────────────────────────

  private async toggleAgentMode(): Promise<void> {
    if (this.gate.enabled) {
      this.gate.reset();
      this.deps.onAgentMode(false, 'IDLE');
      this.activity.record('Agent Mode exited', 'info', Date.now());
      this.showTab('agent');
      await this.publish();
      return;
    }
    await this.enterAgentMode();
  }

  /**
   * Explicit entry. Requires a live server-issued activation FIRST: the mode is
   * never "entered" on the strength of a UI click alone.
   */
  private async enterAgentMode(): Promise<void> {
    const root = this.deps.workspaceRoot();
    if (!root) {
      void vscode.window.showWarningMessage('Open a workspace folder before entering Agent Mode.');
      return;
    }
    if (!this.deps.migraAiClient.agentActivationStatus().valid) {
      try {
        await this.deps.authorizeWorkspace(root);
      } catch {
        this.notice('Agent Mode activation is required. Run "MigraPilot: Pair Agent Mode Securely" first.', 'warn');
        this.showTab('agent');
        await this.publish();
        return;
      }
    }
    this.gate.enter();
    this.deps.onAgentMode(true, this.currentRun?.state ?? 'IDLE');
    this.activity.record('Agent Mode entered (governed)', 'info', Date.now());
    this.showTab('agent');
    await this.loadHistory();
    await this.publish();
  }

  private async propose(recipe: string | undefined): Promise<void> {
    if (!this.requireGate()) return;
    const root = this.deps.workspaceRoot();
    if (!root) {
      this.notice('Open a workspace folder before proposing an Agent Mode command.', 'warn');
      return;
    }
    if (recipe !== 'git.status' && recipe !== 'git.diff') {
      this.notice('That recipe is not available. Only server-owned recipes can be proposed.', 'warn');
      return;
    }
    const reason = await vscode.window.showInputBox({
      title: 'Agent Mode — reason for this recipe',
      prompt: 'Why should MigraPilot run this server-owned recipe? (recorded in the durable evidence)',
      value: 'Run the selected hardened Git inspection recipe.',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length >= 1 && value.length <= 500 ? undefined : 'Provide a bounded reason (1–500 characters).'),
    });
    if (!reason) return;

    try {
      const authorizedRoot = await this.deps.authorizeWorkspace(root);
      const proposed = await this.applyRun(
        await this.deps.migraAiClient.proposeAgentModeCommand({ rootPath: authorizedRoot, recipe, reason: reason.trim() }),
      );
      // The engine requires an explicit "preview displayed" acknowledgement
      // before an approval is valid. The fingerprint stays host-side.
      const fingerprint = proposed.preview?.fingerprint;
      if (proposed.state === 'AWAITING_APPROVAL' && fingerprint) {
        await this.applyRun(await this.deps.migraAiClient.markAgentModePreviewDisplayed(proposed.runId, fingerprint));
      }
      this.activity.record(`Proposal created for ${recipe}`, 'info', Date.now());
    } catch (error) {
      this.notice(this.reason(error), 'error');
      this.deps.output.appendLine(`[shell agent-mode] propose failed: ${this.reason(error)}`);
    }
    await this.publish();
  }

  private async onAgentIntent(intent: string | undefined): Promise<void> {
    if (!intent) return;
    if (intent === 'reviewDiff') {
      this.showTab('diff');
      await this.loadWorkingChanges();
      return;
    }
    if (intent === 'inspectEvidence' || intent === 'exportEvidence') {
      // Evidence reads never require the gate — they carry no execution authority.
      await this.onEvidenceAction(intent, this.currentRun?.runId);
      return;
    }
    if (!this.requireGate()) return;

    const run = this.currentRun;
    if (!run) {
      this.notice('No authoritative Agent Mode run is active.', 'warn');
      return;
    }
    if (this.agentBusy) {
      this.deps.output.appendLine(`[shell agent-mode] ignored duplicate ${intent} while a lifecycle call is in flight`);
      return;
    }
    this.agentBusy = true;

    try {
      switch (intent) {
        case 'approve':
        case 'reject':
          await this.decide(run, intent);
          return;
        case 'cancel':
          await this.applyRun(await this.deps.migraAiClient.cancelAgentModeCommand(run.runId));
          this.activity.record('Agent run cancelled', 'warn', Date.now());
          return;
        case 'reconcile':
          await this.reconcile(run.runId);
          return;
        case 'repropose':
          await this.repropose(run);
          return;
        default:
          return;
      }
    } catch (error) {
      this.notice(this.reason(error), 'error');
      this.deps.output.appendLine(`[shell agent-mode] ${intent} failed: ${this.reason(error)}`);
    } finally {
      this.agentBusy = false;
      await this.publish();
    }
  }

  /**
   * The approval boundary.
   *
   * The fingerprint is read from AUTHORITATIVE server state held on the host —
   * it is never accepted from the webview, so a compromised or buggy webview
   * cannot approve a different proposal than the one the operator reviewed.
   */
  private async decide(run: AgentModeCommandRunView, decision: 'approve' | 'reject'): Promise<void> {
    const fingerprint = run.preview?.fingerprint;
    if (!fingerprint) {
      this.notice('The authoritative preview is unavailable, so this decision cannot be bound.', 'warn');
      return;
    }
    if (decision === 'approve') {
      const card = toProposalCard(run, Date.now());
      const confirmed = await vscode.window.showWarningMessage(
        'Approve this Agent Mode recipe once?',
        { modal: true, detail: approvalConsentDetail(card.task, card.policy, card.changes.note, card.warnings) },
        'Approve once',
      );
      if (confirmed !== 'Approve once') return;
    }
    await this.applyRun(await this.deps.migraAiClient.decideAgentModeCommand(run.runId, decision, fingerprint));
    this.activity.record(decision === 'approve' ? 'Proposal approved once' : 'Proposal rejected', decision === 'approve' ? 'ok' : 'warn', Date.now());
  }

  private async repropose(run: AgentModeCommandRunView): Promise<void> {
    if (run.recovery?.eligible !== true) {
      this.notice('The engine did not mark this run eligible for a fresh proposal.', 'warn');
      return;
    }
    const confirmed = await vscode.window.showWarningMessage(
      'Create a fresh Agent Mode proposal from this run?',
      {
        modal: true,
        detail:
          'This does not resume or execute the previous run. It creates a new server proposal that must be reviewed and approved again.',
      },
      'Create fresh proposal',
    );
    if (confirmed !== 'Create fresh proposal') return;
    const proposed = await this.applyRun(
      await this.deps.migraAiClient.reproposeAgentModeCommand(run.runId, {
        requestId: randomUUID(),
        reason: 'Operator requested a fresh proposal from the prior run.',
      }),
    );
    const fingerprint = proposed.preview?.fingerprint;
    if (proposed.state === 'AWAITING_APPROVAL' && fingerprint) {
      await this.applyRun(await this.deps.migraAiClient.markAgentModePreviewDisplayed(proposed.runId, fingerprint));
    }
    this.activity.record('Fresh proposal created from a prior run', 'info', Date.now());
  }

  private async reconcile(runId: string): Promise<void> {
    try {
      await this.applyRun(await this.deps.migraAiClient.getAgentModeCommand(runId));
    } catch (error) {
      this.deps.output.appendLine(`[shell agent-mode] reconcile failed: ${this.reason(error)}`);
      this.notice('Authoritative run state could not be read.', 'warn');
    }
  }

  private async onEvidenceAction(action: string | undefined, runId: string | undefined): Promise<void> {
    const target = runId ?? this.detail?.summary.runId ?? this.currentRun?.runId;
    if (!target) {
      this.notice('Select a run first to read its evidence.', 'warn');
      return;
    }
    try {
      if (action === 'inspectEvidence') {
        await this.loadRunDetail(target);
        return;
      }
      if (action === 'exportEvidence') {
        const exported = await this.deps.migraAiClient.exportAgentModeRunEvidence(target);
        const summary = toEvidenceExportSummary(exported);
        const uri = await vscode.window.showSaveDialog({
          filters: { JSON: ['json'] },
          saveLabel: 'Save evidence manifest',
        });
        if (!uri) return;
        await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exported, null, 2), 'utf-8'));
        this.activity.record('Evidence exported', 'ok', Date.now());
        this.notice(`Evidence exported — ${summary.rows.map((row) => `${row.label}: ${row.value}`).join(' · ')}`, 'info');
        await this.publish();
      }
    } catch (error) {
      this.notice('Run evidence could not be read or exported.', 'warn');
      this.deps.output.appendLine(`[shell agent-mode] evidence ${action} failed: ${this.reason(error)}`);
    }
  }

  /** Record authoritative run state and reflect it everywhere. */
  private async applyRun(view: AgentModeCommandRunView): Promise<AgentModeCommandRunView> {
    this.currentRun = view;
    await this.deps.memento.update(ACTIVE_RUN_KEY, view.runId);
    this.deps.onAgentMode(this.gate.enabled, view.state);
    await this.publish();
    return view;
  }

  private requireGate(): boolean {
    if (this.gate.enabled) return true;
    this.notice('Enter Agent Mode explicitly before proposing or controlling a command.', 'warn');
    void this.publish();
    return false;
  }

  // ── Voice ──────────────────────────────────────────────────────────────────

  /** The webview cannot reach a backend (CSP `connect-src 'none'`), so recorded
   * audio is relayed through the host to the LOCAL speech endpoint. */
  private async transcribe(audioBase64: string | undefined, mime: string | undefined): Promise<void> {
    if (!audioBase64) return;
    const url = String(vscode.workspace.getConfiguration('migrapilot').get('transcribeUrl', '')).trim();
    if (!url) {
      this.post({ type: 'transcribeError', text: 'Voice input is unavailable — no local speech service is configured.' });
      return;
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60_000);
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio: audioBase64, mime: mime ?? 'audio/webm' }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!response.ok) throw new Error(`transcribe HTTP ${response.status}`);
      const body = (await response.json()) as { text?: string; transcript?: string };
      this.post({ type: 'transcribeResult', text: (body.text ?? body.transcript ?? '').trim() });
    } catch (error) {
      this.deps.output.appendLine(`[shell transcribe] ${this.reason(error)}`);
      this.post({ type: 'transcribeError', text: 'Voice transcription is unavailable. Ensure the local speech service is running.' });
    }
  }

  // ── Public hooks for the extension host ────────────────────────────────────

  /** The exact state the webview would render. Used by the installed-acceptance
   * gate to assert what the Command Center actually shows, against a live
   * engine, without needing UI automation. */
  currentState(): ShellState {
    return this.buildState();
  }

  /** Drive the tab's on-demand read — what clicking the tab does. */
  async loadTab(tab: ShellTabId): Promise<void> {
    this.tab = tab;
    await this.loadForTab(tab);
  }

  /** Drive a Workspace-tab control — what clicking that button does. */
  async runWorkspaceIntentForTest(intent: string): Promise<void> {
    await this.onWorkspaceIntent(intent);
  }

  /** Record a real, observed lifecycle event for the activity feed. */
  recordActivity(text: string, tone: 'ok' | 'info' | 'warn' | 'error'): void {
    this.activity.record(text, tone, Date.now());
    void this.publish();
  }

  agentModeEnabled(): boolean {
    return this.gate.enabled;
  }

  /** Bounded, operator-safe reason. Never a stack trace or raw backend body. */
  private reason(error: unknown): string {
    if (isPilotError(error)) return `${error.code}: ${error.message}`.slice(0, 300);
    if (error instanceof Error) return error.message.slice(0, 300);
    return 'MigraPilot could not complete the request.';
  }
}
