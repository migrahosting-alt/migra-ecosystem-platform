// MigraPilot Shell — left navigation region (§3) + bottom status summary (§12).
//
// MigraPilotNavigation · ConversationList · WorkspaceSummary ·
// ToolsStatusList · StatusSummary
//
// Counts and statuses come from canonical runtime/durable state. A count the
// extension could not read is `undefined` and renders blank — never `0`, because
// "0 pending approvals" and "pending approvals unknown" are different facts.

import type { ConversationMeta } from '../../services/migraAiClient.js';
import type { GitContextSnapshot } from './contextPanelModel.js';
import { type Badge, type Row, type Tone, optionalRow, relativeAge } from './types.js';
import { classify, isProductSurface, visibleIds } from './surfaceClassification.js';

// ── Conversation list ─────────────────────────────────────────────────────────

export interface ConversationRow {
  id: string;
  title: string;
  age: string;
  active: boolean;
  /** Durable conversations are marked so the operator knows what is persisted. */
  durable: boolean;
}

export interface ConversationListModel {
  state: 'ready' | 'empty' | 'disconnected' | 'loading';
  rows: ConversationRow[];
  message?: string;
}

/** Newest first, bounded, with the active conversation highlighted. */
export function toConversationList(
  conversations: readonly ConversationMeta[] | undefined,
  activeId: string | undefined,
  now: number,
  limit = 12,
  error?: string,
): ConversationListModel {
  if (error) return { state: 'disconnected', rows: [], message: error };
  if (!conversations) return { state: 'loading', rows: [], message: 'Loading conversations…' };
  if (!conversations.length) {
    return { state: 'empty', rows: [], message: 'No conversations yet. Start one to begin.' };
  }
  const rows = [...conversations]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map((conversation) => ({
      id: conversation.id,
      title: conversation.title?.trim() || 'Untitled conversation',
      age: relativeAge(conversation.updatedAt, now),
      active: conversation.id === activeId,
      durable: conversation.memoryMode === 'durable',
    }));
  return { state: 'ready', rows };
}

// ── Agent Mode section ────────────────────────────────────────────────────────

export interface AgentModeNavModel {
  /** Canonical: whether the operator entered Agent Mode this session. */
  active: boolean;
  statusText: string;
  statusTone: Tone;
  /** `undefined` = not readable, rendered blank rather than as zero. */
  pendingApprovals?: number;
  activeRuns?: number;
  runHistory?: number;
  /** Why a count is missing, for the tooltip. */
  countsNote?: string;
}

export interface AgentModeCounts {
  pendingApprovals?: number;
  activeRuns?: number;
  runHistory?: number;
  note?: string;
}

export function toAgentModeNav(active: boolean, counts: AgentModeCounts): AgentModeNavModel {
  return {
    active,
    statusText: active ? 'ACTIVE' : 'OFF',
    statusTone: active ? 'governed' : 'muted',
    ...(counts.pendingApprovals !== undefined ? { pendingApprovals: counts.pendingApprovals } : {}),
    ...(counts.activeRuns !== undefined ? { activeRuns: counts.activeRuns } : {}),
    ...(counts.runHistory !== undefined ? { runHistory: counts.runHistory } : {}),
    ...(counts.note ? { countsNote: counts.note } : {}),
  };
}

// ── Workspace summary ─────────────────────────────────────────────────────────

export interface WorkspaceSummaryModel {
  state: 'ready' | 'empty' | 'disconnected';
  name: string;
  branch?: string;
  cleanLabel?: string;
  cleanTone?: Tone;
  message?: string;
}

export function toWorkspaceSummary(workspaceName: string | undefined, git: GitContextSnapshot | undefined): WorkspaceSummaryModel {
  if (!workspaceName) {
    return { state: 'empty', name: 'No folder open', message: 'Open a folder in VS Code to give MigraPilot workspace context.' };
  }
  if (!git || git.unavailableReason) {
    return {
      state: 'disconnected',
      name: workspaceName,
      ...(git?.unavailableReason ? { message: git.unavailableReason } : { message: 'Reading repository state…' }),
    };
  }
  return {
    state: 'ready',
    name: workspaceName,
    ...(git.branch ? { branch: git.branch } : {}),
    ...(git.clean === undefined
      ? {}
      : git.clean
        ? { cleanLabel: 'Clean', cleanTone: 'ok' as Tone }
        : { cleanLabel: `${git.changedFileCount ?? 0} changed`, cleanTone: 'warn' as Tone }),
  };
}

// ── Tools & services ──────────────────────────────────────────────────────────

export interface ToolStatusRow {
  id: string;
  label: string;
  value: string;
  tone: Tone;
  /** Command the row opens, when one applies. */
  command?: string;
}

/** Canonical inputs. Anything the extension could not verify stays `undefined`
 * and is rendered as "Unknown" in a muted tone — never "Online"/"Ready". */
export interface ToolsStatusInput {
  brainStatus?: string;
  /** Number of chat-capable models the engine reported. */
  modelCount?: number;
  modelsError?: string;
  gitAvailable?: boolean;
  policy?: string;
  /** Durable audit store health, from `/health` → `operational.status`. */
  auditStatus?: string;
}

export function toToolsStatusList(input: ToolsStatusInput): ToolStatusRow[] {
  return [
    {
      id: 'brain',
      label: 'Brain Service',
      command: 'health',
      ...statusValue(input.brainStatus, {
        ok: ['ok'],
        okLabel: 'Online',
        warn: ['degraded'],
        warnLabel: 'Degraded',
      }),
    },
    {
      id: 'models',
      label: 'Local Models',
      command: 'providerStatus',
      ...(input.modelsError
        ? { value: 'Unavailable', tone: 'error' as Tone }
        : input.modelCount === undefined
          ? { value: 'Unknown', tone: 'muted' as Tone }
          : input.modelCount > 0
            ? { value: `${input.modelCount} ready`, tone: 'ok' as Tone }
            : { value: 'None approved', tone: 'warn' as Tone }),
    },
    {
      id: 'git',
      label: 'Git Integration',
      ...(input.gitAvailable === undefined
        ? { value: 'Unknown', tone: 'muted' as Tone }
        : input.gitAvailable
          ? { value: 'Connected', tone: 'ok' as Tone }
          : { value: 'Not a repository', tone: 'muted' as Tone }),
    },
    {
      id: 'policy',
      label: 'Policy Engine',
      command: 'executionPolicy',
      ...(input.policy ? { value: input.policy, tone: 'info' as Tone } : { value: 'Unknown', tone: 'muted' as Tone }),
    },
    {
      id: 'audit',
      label: 'Audit Store',
      command: 'openHistory',
      ...statusValue(input.auditStatus, {
        ok: ['healthy'],
        okLabel: 'Healthy',
        warn: ['degraded', 'disabled', 'unavailable'],
      }),
    },
  ];
}

function statusValue(
  raw: string | undefined,
  spec: { ok: string[]; okLabel: string; warn: string[]; warnLabel?: string },
): { value: string; tone: Tone } {
  if (!raw) return { value: 'Unknown', tone: 'muted' };
  if (spec.ok.includes(raw)) return { value: spec.okLabel, tone: 'ok' };
  if (spec.warn.includes(raw)) return { value: spec.warnLabel ?? capitalize(raw), tone: 'warn' };
  return { value: capitalize(raw), tone: 'error' };
}

function capitalize(value: string): string {
  return value.length ? value[0]!.toUpperCase() + value.slice(1) : value;
}

// ── Launcher actions ──────────────────────────────────────────────────────────

/**
 * The sidebar is a compact LAUNCHER, not a second product surface.
 *
 * This is the complete, approved set of visible sidebar actions. Everything that
 * involves a chat composer, an Agent Mode approval, or a run-history record opens
 * the Command Center instead of rendering a second copy here — that is what keeps
 * exactly one composer, one approval path and one history surface in the product.
 *
 * `kind` decides how the host dispatches the row:
 *   - `studio` → reveal the Command Center on a specific tab;
 *   - `command` → execute an already-registered `migrapilot.*` command;
 *   - `shell`  → a shell action the provider handles (e.g. settings).
 *
 * `counter` names a canonical Agent Mode count to display; a count the extension
 * could not read renders blank rather than as a reassuring zero.
 */
export interface NavAction {
  id: string;
  label: string;
  icon: string;
  kind: 'studio' | 'command' | 'shell';
  /** Tab id for `studio`, command suffix for `command`, action id for `shell`. */
  target: string;
  counter?: 'pendingApprovals' | 'activeRuns' | 'runHistory';
  /** Rendered as the prominent primary button rather than a list row. */
  primary?: boolean;
  /**
   * Section the row belongs to. `primary` rows sit above every section.
   *
   * `quick` is the product's Quick Actions list — four outcomes. `agent` and
   * `service` are engineering sections that only developer mode renders.
   */
  group?: 'quick' | 'agent' | 'service';
}

/**
 * Every row the sidebar can render.
 *
 * THE PRODUCT SIDEBAR IS FOUR THINGS: start a task, resume a recent one, see
 * where you are, and reach for one of four outcomes. Everything else — Agent
 * Mode, Tools & Services, Brain lifecycle — is declared here, classified as
 * engineering in `surfaceClassification.ts`, and rendered only in developer
 * mode. None of it is deleted, and none of the backends behind it change.
 *
 * `Open Command Center` is gone as a row: the primary button now STARTS A TASK,
 * which is what a person came to do. It opens the same surface.
 */
export const NAV_ACTIONS: readonly NavAction[] = [
  { id: 'newTask', label: 'New Task', icon: 'add', kind: 'studio', target: 'chat', primary: true },
  // Quick Actions — the four outcomes, each reaching a real command or tab.
  { id: 'explainCode', label: 'Explain Code', icon: 'search', kind: 'command', target: 'explainSelection', group: 'quick' },
  { id: 'fixCode', label: 'Fix Code', icon: 'code', kind: 'command', target: 'quickEdit', group: 'quick' },
  { id: 'reviewChanges', label: 'Review Changes', icon: 'git-compare', kind: 'studio', target: 'diff', group: 'quick' },
  { id: 'runTests', label: 'Run Tests', icon: 'beaker', kind: 'command', target: 'runTests', group: 'quick' },
  // Shown ONLY when something is actually waiting on the user — see the
  // approvals block in the navigation renderer. Not a permanent section.
  { id: 'pendingApprovals', label: 'Needs your approval', icon: 'shield', kind: 'studio', target: 'agent', counter: 'pendingApprovals' },
  // Engineering: developer mode only.
  { id: 'submitTask', label: 'Submit Agent Task', icon: 'rocket', kind: 'studio', target: 'agent', group: 'agent' },
  { id: 'activeRuns', label: 'Active Runs', icon: 'pulse', kind: 'studio', target: 'agent', counter: 'activeRuns', group: 'agent' },
  { id: 'runHistory', label: 'Run History', icon: 'history', kind: 'studio', target: 'audit', counter: 'runHistory', group: 'agent' },
  { id: 'brainStatus', label: 'Brain Status', icon: 'info', kind: 'command', target: 'health', group: 'service' },
  { id: 'repairConnection', label: 'Repair Connection', icon: 'sync', kind: 'command', target: 'repairConnection', group: 'service' },
  { id: 'logs', label: 'Logs', icon: 'file', kind: 'command', target: 'showLogs', group: 'service' },
  // Settings has NO group: the footer gear provides it in both modes, and a
  // product row parked inside an engineering section would render in neither.
  { id: 'settings', label: 'Settings', icon: 'gear', kind: 'shell', target: 'settings' },
];

/** Rows of a group the current mode may render, in declaration order. */
export function navActionsFor(group: NavAction['group'], developerMode: boolean): NavAction[] {
  const allowed = new Set(visibleIds('nav-action', developerMode));
  return NAV_ACTIONS.filter((action) => !action.primary && action.group === group && allowed.has(action.id));
}

/** True when a sidebar row may be dispatched in the current mode. Fails closed. */
export function navActionAllowed(id: string, developerMode: boolean): boolean {
  return developerMode ? classify('nav-action', id) !== undefined : isProductSurface('nav-action', id);
}

/** The prominent primary action (§7). */
export function navPrimaryAction(): NavAction {
  const primary = NAV_ACTIONS.find((action) => action.primary);
  if (!primary) throw new Error('the navigation must always expose a primary action');
  return primary;
}

export function findNavAction(id: string): NavAction | undefined {
  return NAV_ACTIONS.find((action) => action.id === id);
}

// ── Bottom status summary (§12) ───────────────────────────────────────────────

export interface StatusSummaryModel {
  items: Row[];
}

export interface StatusSummaryInput {
  branch?: string;
  connected: boolean;
  brainStatus?: string;
  schemaVersion?: number;
  policy?: string;
  agentModeActive: boolean;
}

/**
 * The one-line status under the shell.
 *
 * PRODUCT MODE ANSWERS TWO QUESTIONS: where am I working, and is MigraPilot ready.
 * It used to read `Brain: Healthy · Schema: v0 · Policy: auto · Agent Mode: Off` —
 * four pieces of backend state on the surface a user looks at while writing code.
 * That was found by looking at the running product, not by reading the code, which
 * is why the visual gate exists.
 *
 * Developer mode keeps every field.
 */
export function toStatusSummary(input: StatusSummaryInput, developerMode = false): StatusSummaryModel {
  const branch = optionalRow('Branch', input.branch, 'info', true);
  const ready: Row = {
    label: 'MigraPilot',
    value: input.connected ? 'Ready' : 'Not ready',
    tone: input.connected ? 'ok' : 'error',
  };
  if (!developerMode) return { items: [branch, ready].filter(Boolean) as Row[] };
  return {
    items: [
      branch,
      { ...ready, value: input.connected ? 'Connected' : 'Disconnected' },
      {
        label: 'Brain',
        value: input.brainStatus === 'ok' ? 'Healthy' : input.brainStatus ? capitalize(input.brainStatus) : 'Unknown',
        tone: input.brainStatus === 'ok' ? 'ok' : input.brainStatus ? 'warn' : 'muted',
      },
      optionalRow('Schema', input.schemaVersion === undefined ? undefined : `v${input.schemaVersion}`, undefined, true),
      optionalRow('Policy', input.policy, 'info'),
      {
        label: 'Agent Mode',
        value: input.agentModeActive ? 'Governed' : 'Off',
        tone: input.agentModeActive ? 'governed' : 'muted',
      },
    ],
  };
}

// ── Header ────────────────────────────────────────────────────────────────────

/**
 * Every tab the shell can render, in journey order.
 *
 * `chat` and `diff` are the product: ask, then see what changed. The other three
 * are engineering surfaces — they keep working, and their backends are untouched,
 * but `shellTabs()` only hands them out in developer mode. The classification that
 * decides this lives in `surfaceClassification.ts`, so the tab strip and the
 * command palette cannot disagree about what counts as product.
 */
export const SHELL_TABS = [
  { id: 'chat', label: 'Ask', icon: 'comment-discussion' },
  { id: 'diff', label: 'Changes', icon: 'diff' },
  { id: 'agent', label: 'Agent Workspace', icon: 'shield' },
  { id: 'audit', label: 'Audit Trail', icon: 'checklist' },
  { id: 'workspace', label: 'Workspace', icon: 'database' },
] as const;

/** The tab strip for the current mode. Never empty: `chat` is always product. */
export function shellTabs(developerMode: boolean): Array<(typeof SHELL_TABS)[number]> {
  const allowed = new Set(visibleIds('tab', developerMode));
  return SHELL_TABS.filter((tab) => allowed.has(tab.id));
}

/** Product mode must never land on a tab it does not render. */
export function resolveTab(tab: ShellTabId, developerMode: boolean): ShellTabId {
  return shellTabs(developerMode).some((candidate) => candidate.id === tab) ? tab : 'chat';
}

export type ShellTabId = (typeof SHELL_TABS)[number]['id'];

export function isShellTab(value: unknown): value is ShellTabId {
  return typeof value === 'string' && SHELL_TABS.some((tab) => tab.id === value);
}

/** Header brain badge — reuses the health badge so both surfaces agree. */
export function headerBrainBadge(badge: Badge): Badge {
  return badge;
}
