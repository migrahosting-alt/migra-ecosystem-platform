// MigraPilot Shell — the quick actions (§5) and the header bar (§4).
//
// THE PRODUCT IS THE JOURNEY:
//
//   Ask → understand the repository → act → review → verify → result
//
// So the actions are named for OUTCOMES a person wants, not for the machinery that
// delivers them. Every one resolves to a real registered command or a real chat
// turn; nothing here is decorative, and nothing opens an engineering console.
//
// What is NOT here is as deliberate as what is: no "Diagnose System", no "Run
// Agent Task", no "Run History". Those surfaces still exist and their backends are
// untouched — they are classified as engineering in `surfaceClassification.ts` and
// appear only in developer mode.

import { visibleIds } from './surfaceClassification.js';

export type WelcomeActionEffect =
  /** Execute an existing extension command id (without the `migrapilot.` prefix). */
  | { kind: 'command'; command: string }
  /** Seed the composer and submit it as an ordinary chat turn. */
  | { kind: 'prompt'; prompt: string }
  /** Switch the shell to another tab. */
  | { kind: 'tab'; tab: string }
  /**
   * A command that needs a selection, with a real answer when there isn't one.
   *
   * "Select some code first" is a dead end on the second step of the journey. When
   * nothing is selected the same intent is served as a repository question instead.
   */
  | { kind: 'selectionCommand'; command: string; fallbackPrompt: string };

export interface WelcomeAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  accent: 'info' | 'governed' | 'neutral';
  effect: WelcomeActionEffect;
}

/** The six outcomes. Order is the order of the journey, not of the subsystems. */
export const WELCOME_ACTIONS: readonly WelcomeAction[] = [
  {
    id: 'explain',
    title: 'Explain code',
    subtitle: 'Understand this file or repository',
    icon: 'search',
    accent: 'info',
    effect: {
      kind: 'selectionCommand',
      command: 'explainSelection',
      fallbackPrompt: 'Explain how this repository is put together: its purpose, entry points, and the parts I should understand first.',
    },
  },
  {
    id: 'fix',
    title: 'Fix code',
    subtitle: 'Describe a change and see the diff',
    icon: 'code',
    accent: 'info',
    effect: { kind: 'command', command: 'quickEdit' },
  },
  {
    id: 'plan',
    title: 'Plan a task',
    subtitle: 'Work out the approach before changing anything',
    icon: 'checklist',
    accent: 'neutral',
    effect: {
      kind: 'prompt',
      prompt: 'I want to plan a task in this repository. Ask me what I am trying to achieve, then propose an approach and the files it would touch. Do not change anything yet.',
    },
  },
  {
    id: 'review',
    title: 'Review changes',
    subtitle: 'What changed, and on which branch',
    icon: 'git-compare',
    accent: 'info',
    effect: { kind: 'tab', tab: 'diff' },
  },
  {
    id: 'test',
    title: 'Run tests',
    subtitle: 'Verify the change actually works',
    icon: 'beaker',
    accent: 'info',
    effect: { kind: 'command', command: 'runTests' },
  },
  {
    id: 'debug',
    title: 'Debug a failure',
    subtitle: 'Find out why something broke',
    icon: 'pulse',
    accent: 'neutral',
    effect: { kind: 'command', command: 'diagnoseFailure' },
  },
];

export function findWelcomeAction(id: string): WelcomeAction | undefined {
  return WELCOME_ACTIONS.find((action) => action.id === id);
}

/**
 * Resolve an effect against the editor state the host observed.
 *
 * Pure, so both branches of the selection fallback are testable without VS Code.
 */
export function resolveWelcomeEffect(
  effect: WelcomeActionEffect,
  context: { hasSelection: boolean },
): Exclude<WelcomeActionEffect, { kind: 'selectionCommand' }> {
  if (effect.kind !== 'selectionCommand') return effect;
  return context.hasSelection
    ? { kind: 'command', command: effect.command }
    : { kind: 'prompt', prompt: effect.fallbackPrompt };
}

// ── Header bar ────────────────────────────────────────────────────────────────

export interface HeaderAction {
  id: string;
  label: string;
  icon: string;
  accent: 'info' | 'governed' | 'neutral';
}

/** Declared in full; `headerActions(developerMode)` decides which are shown. */
export const HEADER_ACTIONS: readonly HeaderAction[] = [
  { id: 'newTask', label: 'New Task', icon: 'add', accent: 'neutral' },
  { id: 'settings', label: 'Settings', icon: 'gear', accent: 'neutral' },
  { id: 'agentMode', label: 'Agent Mode', icon: 'shield', accent: 'governed' },
  { id: 'audit', label: 'Audit', icon: 'checklist', accent: 'neutral' },
  { id: 'runHistory', label: 'Run History', icon: 'history', accent: 'neutral' },
];

/** The header bar for the current mode, filtered by the locked classification. */
export function headerActions(developerMode: boolean): HeaderAction[] {
  const allowed = new Set(visibleIds('header-action', developerMode));
  return HEADER_ACTIONS.filter((action) => allowed.has(action.id));
}

export const SHELL_TITLE = 'MigraPilot';
export const SHELL_SUBTITLE = 'Ask about your code, change it, verify the result.';
export const WELCOME_SUBTITLE = 'Ask a question, or pick where you want to start.';
