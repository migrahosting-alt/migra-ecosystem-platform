// MigraPilot Shell — welcome quick actions (§5) and the header action bar (§4).
//
// Every quick action resolves to a REAL effect: either an existing registered
// VS Code command, or a seeded prompt submitted through the normal chat turn.
// Nothing here is decorative.

export type WelcomeActionEffect =
  /** Execute an existing extension command id (without the `migrapilot.` prefix). */
  | { kind: 'command'; command: string }
  /** Seed the composer and submit it as an ordinary chat turn. */
  | { kind: 'prompt'; prompt: string }
  /** Switch the shell to another tab. */
  | { kind: 'tab'; tab: string };

export interface WelcomeAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  /** `governed` marks the actions that enter the Agent Mode approval boundary. */
  accent: 'info' | 'governed' | 'neutral';
  effect: WelcomeActionEffect;
}

/**
 * The six cards from the approved mockup. Order is part of the visual contract.
 *
 * - Build or Fix Code / Inspect & Analyze / Diagnose System seed real chat turns
 *   that route through the canonical engine pipeline.
 * - Run Agent Task opens the governed Agent Workspace tab (no execution).
 * - Review Changes runs the existing read-only commit/diff review command.
 * - Run History opens the evidence-only Audit Trail tab.
 */
export const WELCOME_ACTIONS: readonly WelcomeAction[] = [
  {
    id: 'build',
    title: 'Build or Fix Code',
    subtitle: 'Create, refactor, or repair',
    icon: 'code',
    accent: 'info',
    effect: { kind: 'prompt', prompt: 'Build or fix code in this workspace. Start by telling me what you want changed.' },
  },
  {
    id: 'inspect',
    title: 'Inspect & Analyze',
    subtitle: 'Deep repository insight',
    icon: 'search',
    accent: 'info',
    effect: { kind: 'prompt', prompt: 'Inspect this repository and summarize its architecture, entry points, and risks.' },
  },
  {
    id: 'agentTask',
    title: 'Run Agent Task',
    subtitle: 'Governed execution',
    icon: 'rocket',
    accent: 'governed',
    effect: { kind: 'tab', tab: 'agent' },
  },
  {
    id: 'diagnose',
    title: 'Diagnose System',
    subtitle: 'Health & performance',
    icon: 'pulse',
    accent: 'info',
    effect: { kind: 'command', command: 'showDiagnostics' },
  },
  {
    id: 'review',
    title: 'Review Changes',
    subtitle: 'Diff, history, and impact',
    icon: 'git-compare',
    accent: 'info',
    effect: { kind: 'tab', tab: 'diff' },
  },
  {
    id: 'history',
    title: 'Run History',
    subtitle: 'View evidence & audit',
    icon: 'history',
    accent: 'neutral',
    effect: { kind: 'tab', tab: 'audit' },
  },
];

export function findWelcomeAction(id: string): WelcomeAction | undefined {
  return WELCOME_ACTIONS.find((action) => action.id === id);
}

/** Header controls (§4). `command` values are dispatched by the host against the
 * existing command registry, so no new execution path is introduced. */
export interface HeaderAction {
  id: string;
  label: string;
  icon: string;
  accent: 'info' | 'governed' | 'neutral';
}

export const HEADER_ACTIONS: readonly HeaderAction[] = [
  { id: 'newTask', label: 'New Task', icon: 'add', accent: 'neutral' },
  { id: 'agentMode', label: 'Agent Mode', icon: 'shield', accent: 'governed' },
  { id: 'audit', label: 'Audit', icon: 'checklist', accent: 'neutral' },
  { id: 'runHistory', label: 'Run History', icon: 'history', accent: 'neutral' },
  { id: 'settings', label: 'Settings', icon: 'gear', accent: 'neutral' },
];

export const SHELL_TITLE = 'MigraPilot';
export const SHELL_SUBTITLE = 'Your AI Engineering Copilot';
export const WELCOME_SUBTITLE = 'Your governed AI engineering and infrastructure copilot.';
