// MigraPilot Shell — composer rules (§11).
//
// Pure decision logic for the integrated composer so the keyboard contract,
// the disabled/loading states, the duplicate-submit guard, and the accessible
// labels are all unit-testable without a DOM.

export const COMPOSER_PLACEHOLDER = 'Ask MigraPilot to inspect, build, diagnose, or plan...';

export interface ComposerInput {
  /** A turn is already in flight on the host. */
  inFlight: boolean;
  /** The backend is reachable. */
  connected: boolean;
  /** Voice is only offered when the host reported a transcription endpoint AND
   * the webview can record. */
  voiceSupported: boolean;
  /** Text currently in the box. */
  text: string;
  /** Attachments staged for this turn. */
  attachmentCount: number;
}

export interface ComposerState {
  placeholder: string;
  /** Whole composer disabled (submission blocked). */
  disabled: boolean;
  /** Send button enabled. */
  canSend: boolean;
  /** Show the stop affordance instead of send. */
  showStop: boolean;
  /** Voice control state — never a fake "recording" affordance. */
  voice: 'available' | 'unavailable';
  voiceLabel: string;
  sendLabel: string;
  /** Bounded hint under the composer; empty string when there is nothing to say. */
  hint: string;
}

export function composerState(input: ComposerInput): ComposerState {
  const hasContent = input.text.trim().length > 0 || input.attachmentCount > 0;
  const disabled = !input.connected;
  return {
    placeholder: COMPOSER_PLACEHOLDER,
    disabled,
    canSend: !disabled && !input.inFlight && hasContent,
    showStop: input.inFlight,
    voice: input.voiceSupported ? 'available' : 'unavailable',
    voiceLabel: input.voiceSupported
      ? 'Voice input — click to record, click again to stop'
      : 'Voice input unavailable — no local speech service is configured',
    sendLabel: input.inFlight ? 'A response is streaming' : 'Send message (Enter)',
    hint: disabled
      ? 'MigraPilot is disconnected. Repair the connection to send a message.'
      : input.inFlight
        ? 'Streaming a response — press Escape to stop.'
        : '',
  };
}

/**
 * Keyboard contract: Enter sends, Shift+Enter inserts a newline. Returns the
 * action the webview should take so the rule is testable in isolation.
 */
export function composerKeyAction(key: string, shift: boolean, paletteOpen: boolean): 'send' | 'newline' | 'palette' | 'ignore' {
  if (key !== 'Enter') return 'ignore';
  // An open slash-command palette owns Enter (it selects the highlighted item).
  if (paletteOpen) return 'palette';
  return shift ? 'newline' : 'send';
}

/**
 * Single source of truth for the duplicate-submit guard. The webview asks this
 * before dispatching, and the host independently refuses a second concurrent
 * turn — two layers, because a double dispatch must never reach the backend.
 */
export function shouldDispatchSubmit(state: { inFlight: boolean; dispatching: boolean; hasContent: boolean; connected: boolean }): boolean {
  if (!state.connected) return false;
  if (!state.hasContent) return false;
  if (state.inFlight) return false;
  if (state.dispatching) return false;
  return true;
}

/** Slash commands offered by the composer. Each maps to a real effect. */
export interface SlashCommand {
  name: string;
  args: string;
  description: string;
  effect: { kind: 'command'; command: string } | { kind: 'prompt'; prefix: string } | { kind: 'shell'; action: string };
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: '/explain', args: '<code>', description: 'Explain the current selection', effect: { kind: 'command', command: 'explainSelection' } },
  { name: '/fix', args: '<issue>', description: 'Fix reported diagnostics', effect: { kind: 'command', command: 'fixDiagnostics' } },
  { name: '/test', args: '<file>', description: 'Generate tests', effect: { kind: 'command', command: 'generateTests' } },
  { name: '/commit', args: '', description: 'Generate a commit message', effect: { kind: 'command', command: 'generateCommit' } },
  { name: '/diagnostics', args: '', description: 'Show workspace diagnostics', effect: { kind: 'command', command: 'showDiagnostics' } },
  { name: '/health', args: '', description: 'Check Brain service health', effect: { kind: 'command', command: 'health' } },
  { name: '/policy', args: '', description: 'Choose the execution policy', effect: { kind: 'command', command: 'executionPolicy' } },
  { name: '/agent', args: '', description: 'Open the governed Agent Workspace', effect: { kind: 'shell', action: 'tab:agent' } },
  { name: '/history', args: '', description: 'Open the evidence-only Audit Trail', effect: { kind: 'shell', action: 'tab:audit' } },
  { name: '/refactor', args: '<code>', description: 'Refactor the selection', effect: { kind: 'prompt', prefix: 'Refactor this code: ' } },
  { name: '/review', args: '', description: 'Review the working changes', effect: { kind: 'shell', action: 'tab:diff' } },
  { name: '/new', args: '', description: 'Start a new conversation', effect: { kind: 'shell', action: 'newChat' } },
];

export function matchSlashCommands(query: string): SlashCommand[] {
  const needle = query.replace(/^\//, '').toLowerCase();
  if (!needle) return [...SLASH_COMMANDS];
  return SLASH_COMMANDS.filter(
    (command) => command.name.slice(1).toLowerCase().startsWith(needle) || command.description.toLowerCase().includes(needle),
  );
}

/** Model/routing selector options. `auto` lets the engine's router decide. */
export const ROUTING_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'cheap', label: 'Fast' },
  { value: 'default', label: 'Balanced' },
  { value: 'premium', label: 'Deep' },
] as const;
