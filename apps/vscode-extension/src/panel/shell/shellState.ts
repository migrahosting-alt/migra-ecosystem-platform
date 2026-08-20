// MigraPilot Shell — the single state contract posted to the webview (§13, §14).
//
// `buildShellState` is a PURE function of canonical inputs, so every state the
// directive requires (loading / ready / empty / disconnected / unauthorized /
// activation-required / degraded / error) is reproducible in a unit test without
// a running Brain, a workspace, or a webview.
//
// Because this is the ONLY structure the webview receives, it is also the audit
// boundary: if a field is not on this type, it cannot be rendered.

import type { AgentModeCommandRunView, AgentModeRunHistoryDetail, AgentModeRunHistoryEvent, AgentModeRunHistoryList } from '@migrapilot/protocol';
import type { ConversationMeta } from '../../services/migraAiClient.js';
import {
  type ActivityEntry,
  type AgentActivationStatus,
  type ActiveRunSummary,
  type BrainHealthPanelModel,
  type BrainHealthSnapshot,
  type ContextFileEntry,
  type GitContextSnapshot,
  toActiveRunSummary,
  toAgentContextPanel,
  toBrainHealthPanel,
  toContextFilesPanel,
  toRecentActivityPanel,
  toWorkspaceContextPanel,
  toProductBrainPanel,
  withHistoryIntegrity,
} from './contextPanelModel.js';
import {
  type AgentModeCounts,
  type AgentModeNavModel,
  type ConversationListModel,
  type ShellTabId,
  type StatusSummaryModel,
  type ToolStatusRow,
  type WorkspaceSummaryModel,
  toAgentModeNav,
  toConversationList,
  toStatusSummary,
  toToolsStatusList,
  toWorkspaceSummary,
} from './navigationModel.js';
import { type ProgressStage, type ProposalCard, toProgressStages, toProposalCard } from './proposalCardModel.js';
import { type RunDetailModel, type RunHistoryListModel, toRunDetail, toRunHistoryList } from './runHistoryModel.js';
import type { DataState, Panel, Row } from './types.js';
import { type WorkspaceTabModel, emptyWorkspaceTab, loadingWorkspaceTab, toWorkspaceTab } from './workspaceTabModel.js';
import type { WorkspacePanelModel } from '../workspaceViewModel.js';

/** Working-tree change list for the Run Diff tab. Produced from the same
 * read-only git allow-list used by commit generation. */
export interface WorkingChange {
  path: string;
  status: string;
  added: number;
  removed: number;
  binary: boolean;
  staged: boolean;
}

export interface RunDiffModel {
  state: DataState;
  message?: string;
  /** Summary rows (files / additions / deletions). */
  rows: Row[];
  changes: WorkingChange[];
  /** Server-declared expected effects of the active proposal, when one exists. */
  expectedEffects: string[];
}

export interface ShellAgentModel {
  modeActive: boolean;
  activationValid: boolean;
  progress: ProgressStage[];
  proposal?: ProposalCard;
  /** Bounded operator guidance (e.g. why a run cannot continue). */
  note?: string;
  /** Server-owned recipes the activation allows. Empty until activated. */
  recipes: Array<{ id: string; label: string }>;
  /** Explains a blocked Agent Workspace instead of showing dead controls. */
  blocked?: { state: DataState; message: string; retryCommand?: string; retryLabel?: string };
}

export interface ShellState {
  /** Host clock, so relative times render consistently without a webview clock. */
  now: number;
  tab?: ShellTabId;
  nav: {
    conversations: ConversationListModel;
    agentMode: AgentModeNavModel;
    workspace: WorkspaceSummaryModel;
    tools: ToolStatusRow[];
    identity: { workspaceName?: string; branch?: string; product: string };
  };
  context: {
    workspace: Panel;
    brain: BrainHealthPanelModel;
    agent: Panel;
    run: ActiveRunSummary;
    files: Panel;
    activity: Panel;
  };
  agent: ShellAgentModel;
  history: RunHistoryListModel;
  detail: RunDetailModel;
  diff: RunDiffModel;
  /** MigraAI Workspace — the consolidated Workspace tab. */
  workspace: WorkspaceTabModel;
  status: StatusSummaryModel;
  composer: { connected: boolean; voiceSupported: boolean };
}

/** Everything the host knows, in canonical form. Any `undefined` means "not
 * read yet / not readable" and the models render it honestly. */
export interface ShellStateInput {
  now: number;
  tab?: ShellTabId;
  brainEndpoint: string;
  brainHealth?: BrainHealthSnapshot;
  brainError?: string;
  /** Reveal engineering state. Absent = product mode, which is how it ships. */
  developerMode?: boolean;
  git?: GitContextSnapshot;
  workspaceName?: string;
  conversations?: readonly ConversationMeta[];
  conversationsError?: string;
  activeConversationId?: string;
  modelCount?: number;
  modelsError?: string;
  policy?: string;
  agentModeActive: boolean;
  activation?: AgentActivationStatus;
  activeRun?: AgentModeCommandRunView;
  activeRunTimeline?: readonly AgentModeRunHistoryEvent[];
  /** Integrity for the active run, when its history record exists. */
  activeRunIntegrity?: { integrity: string; issues: readonly string[] };
  history?: AgentModeRunHistoryList;
  historyError?: { kind: 'activation' | 'transport'; message: string };
  detail?: AgentModeRunHistoryDetail;
  workingChanges?: readonly WorkingChange[];
  workingChangesError?: string;
  contextFiles?: readonly ContextFileEntry[];
  activity?: readonly ActivityEntry[];
  /** Authoritative MigraAI workspace model, or undefined when none is open. */
  workspaceModel?: WorkspacePanelModel;
  /** Set while the host has not yet read workspace state. */
  workspaceLoading?: boolean;
  workspaceError?: string;
  /** Why the tab is empty while the engine IS reachable. */
  workspaceEmptyReason?: string;
  voiceSupported: boolean;
}

export function buildShellState(input: ShellStateInput): ShellState {
  const {
    now,
    brainEndpoint,
    brainHealth,
    brainError,
    git,
    workspaceName,
    agentModeActive,
    activation,
    activeRun,
    policy,
  } = input;

  const fullBrain = toBrainHealthPanel(brainEndpoint, brainHealth, brainError);
  // Product mode never posts the endpoint, version, schema version or retention
  // worker to the webview — not merely leaves them undrawn.
  const brain = input.developerMode === true ? fullBrain : toProductBrainPanel(fullBrain);
  const connected = !brainError && Boolean(brainHealth);
  const schemaVersion = brainHealth?.operational?.schemaVersion ?? brainHealth?.readiness?.schemaVersion;

  const runSummaryBase = toActiveRunSummary(activeRun);
  const runSummary = input.activeRunIntegrity
    ? withHistoryIntegrity(runSummaryBase, input.activeRunIntegrity.integrity, input.activeRunIntegrity.issues)
    : runSummaryBase;

  return {
    now,
    ...(input.tab ? { tab: input.tab } : {}),
    nav: {
      conversations: toConversationList(input.conversations, input.activeConversationId, now, 12, input.conversationsError),
      agentMode: toAgentModeNav(agentModeActive, agentModeCounts(input)),
      workspace: toWorkspaceSummary(workspaceName, git),
      tools: toToolsStatusList({
        ...(brainHealth?.status !== undefined ? { brainStatus: brainHealth.status } : {}),
        ...(input.modelCount !== undefined ? { modelCount: input.modelCount } : {}),
        ...(input.modelsError ? { modelsError: input.modelsError } : {}),
        ...(git === undefined ? {} : { gitAvailable: !git.unavailableReason }),
        ...(policy ? { policy } : {}),
        ...(brainHealth?.operational?.status !== undefined ? { auditStatus: brainHealth.operational.status } : {}),
      }),
      identity: {
        ...(workspaceName ? { workspaceName } : {}),
        ...(git?.branch ? { branch: git.branch } : {}),
        product: 'MigraTeck · MigraPilot',
      },
    },
    context: {
      workspace: toWorkspaceContextPanel(git),
      brain,
      agent: toAgentContextPanel({
        modeEntered: agentModeActive,
        activation,
        ...(policy ? { policy } : {}),
        ...(activeRun ? { run: activeRun } : {}),
        now,
      }),
      run: runSummary,
      files: toContextFilesPanel(input.contextFiles ?? []),
      activity: toRecentActivityPanel(input.activity ?? [], now),
    },
    agent: buildAgentModel(input),
    history: toRunHistoryList(input.history, now, input.historyError),
    detail: toRunDetail(input.detail, now),
    diff: buildDiffModel(input),
    workspace: buildWorkspaceTab(input),
    status: toStatusSummary({
      ...(git?.branch ? { branch: git.branch } : {}),
      connected,
      ...(brainHealth?.status !== undefined ? { brainStatus: brainHealth.status } : {}),
      ...(schemaVersion !== undefined ? { schemaVersion } : {}),
      ...(policy ? { policy } : {}),
      agentModeActive,
    }, input.developerMode === true),
    composer: { connected, voiceSupported: input.voiceSupported },
  };
}

/** Counts come from durable/runtime state. When history is unreadable the counts
 * stay `undefined` so the nav renders blank rather than a reassuring zero. */
function agentModeCounts(input: ShellStateInput): AgentModeCounts {
  if (input.historyError) {
    return { note: input.historyError.message };
  }
  if (!input.history) {
    return {};
  }
  const runs = input.history.runs;
  const pendingApprovals = runs.filter((run) => run.state === 'AWAITING_APPROVAL').length
    + (input.activeRun?.state === 'AWAITING_APPROVAL' && !runs.some((run) => run.runId === input.activeRun?.runId) ? 1 : 0);
  const activeRuns = runs.filter((run) => run.state === 'PLANNING' || run.state === 'APPROVED' || run.state === 'EXECUTING').length
    + (input.activeRun && isLive(input.activeRun.state) && !runs.some((run) => run.runId === input.activeRun?.runId) ? 1 : 0);
  return { pendingApprovals, activeRuns, runHistory: runs.length };
}

function isLive(state: AgentModeCommandRunView['state']): boolean {
  return state === 'PLANNING' || state === 'AWAITING_APPROVAL' || state === 'APPROVED' || state === 'EXECUTING';
}

const RECIPE_LABELS: Record<string, string> = {
  'git.status': 'Git status (read-only)',
  'git.diff': 'Git diff (read-only)',
};

function buildAgentModel(input: ShellStateInput): ShellAgentModel {
  const activationValid = input.activation?.valid === true;
  const proposal = input.activeRun ? toProposalCard(input.activeRun, input.now) : undefined;
  const progress = toProgressStages(input.activeRun, input.activeRunTimeline ?? []);
  const note = proposal?.controls.interruptedNote;

  const recipes = activationValid
    ? (input.activation?.allowedRecipes ?? []).map((id) => ({ id, label: RECIPE_LABELS[id] ?? id }))
    : [];

  const blocked: ShellAgentModel['blocked'] | undefined = !activationValid
    ? {
        state: 'activation-required',
        message:
          'Agent Mode is not activated for this workspace. Pair it explicitly — the extension never grants itself execution authority.',
        retryCommand: 'pairAgentMode',
        retryLabel: 'Pair Agent Mode',
      }
    : !input.agentModeActive
      ? {
          state: 'unauthorized',
          message: 'Enter Agent Mode explicitly before proposing or controlling a command.',
          retryCommand: 'enterAgentMode',
          retryLabel: 'Enter Agent Mode',
        }
      : undefined;

  return {
    modeActive: input.agentModeActive,
    activationValid,
    progress,
    ...(proposal ? { proposal } : {}),
    ...(note ? { note } : {}),
    recipes,
    ...(blocked ? { blocked } : {}),
  };
}

function buildDiffModel(input: ShellStateInput): RunDiffModel {
  const expectedEffects = input.activeRun?.preview?.expectedEffects ? [...input.activeRun.preview.expectedEffects] : [];
  if (input.workingChangesError) {
    return { state: 'disconnected', message: input.workingChangesError, rows: [], changes: [], expectedEffects };
  }
  if (!input.workingChanges) {
    return { state: 'loading', message: 'Reading working-tree changes…', rows: [], changes: [], expectedEffects };
  }
  if (!input.workingChanges.length) {
    return { state: 'empty', message: 'No working-tree changes.', rows: [], changes: [], expectedEffects };
  }
  const additions = input.workingChanges.reduce((sum, change) => sum + change.added, 0);
  const deletions = input.workingChanges.reduce((sum, change) => sum + change.removed, 0);
  return {
    state: 'ready',
    rows: [
      { label: 'Files changed', value: String(input.workingChanges.length) },
      { label: 'Additions', value: `+${additions}`, tone: 'ok' },
      { label: 'Deletions', value: `-${deletions}`, tone: 'error' },
      { label: 'Staged', value: String(input.workingChanges.filter((change) => change.staged).length) },
    ],
    changes: [...input.workingChanges],
    expectedEffects,
  };
}

/**
 * The Workspace tab resolves its own state so an engine outage degrades one tab
 * rather than the shell: unreadable is `disconnected`, not "no workspace".
 */
function buildWorkspaceTab(input: ShellStateInput): WorkspaceTabModel {
  // An authoritative model in hand WINS over a previous read failure: a transient
  // error during activation must never latch the tab into "unreachable" while the
  // engine is healthy and the data is right there.
  //
  // The live Git branch is passed in so the tab can distinguish the branch the
  // INDEX was built from (engine state) from the branch checked out RIGHT NOW.
  if (input.workspaceModel) {
    return toWorkspaceTab(input.workspaceModel, {
      ...(input.git?.branch ? { currentBranch: input.git.branch } : {}),
    });
  }
  if (input.workspaceError) return emptyWorkspaceTab(input.workspaceError, true);
  if (input.workspaceLoading) return loadingWorkspaceTab();
  return emptyWorkspaceTab(input.workspaceEmptyReason);
}
