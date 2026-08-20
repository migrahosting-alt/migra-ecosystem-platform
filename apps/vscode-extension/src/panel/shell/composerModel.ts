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
  /**
   * `developer` keeps the entry out of the normal palette.
   *
   * The palette is a real entry point, not decoration: `/agent` opened the Agent
   * Workspace and `/noevidence` changed a governance mode. Hiding the tab while
   * leaving its slash command typeable would have moved the console rather than
   * withdrawn it.
   */
  audience?: 'product' | 'developer';
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  // ── The product: the journey, typed ───────────────────────────────────────
  { name: '/explain', args: '<code>', description: 'Explain the current selection', effect: { kind: 'command', command: 'explainSelection' } },
  { name: '/fix', args: '<issue>', description: 'Fix the problems reported in this file', effect: { kind: 'command', command: 'fixDiagnostics' } },
  { name: '/edit', args: '<change>', description: 'Describe a change and review the diff', effect: { kind: 'command', command: 'quickEdit' } },
  { name: '/refactor', args: '<code>', description: 'Refactor the selection', effect: { kind: 'prompt', prefix: 'Refactor this code: ' } },
  { name: '/review', args: '', description: 'Review the working changes', effect: { kind: 'shell', action: 'tab:diff' } },
  { name: '/changes', args: '', description: 'Git status, history and blame', effect: { kind: 'command', command: 'gitOverview' } },
  { name: '/tests', args: '', description: 'Run the project test suite', effect: { kind: 'command', command: 'runTests' } },
  { name: '/test', args: '<file>', description: 'Write tests for this file', effect: { kind: 'command', command: 'generateTests' } },
  { name: '/debug', args: '', description: 'Diagnose why something failed', effect: { kind: 'command', command: 'diagnoseFailure' } },
  { name: '/run', args: '<command>', description: 'Run a project command', effect: { kind: 'command', command: 'runCommand' } },
  { name: '/commit', args: '', description: 'Write a commit message', effect: { kind: 'command', command: 'generateCommit' } },
  { name: '/new', args: '', description: 'Start a new conversation', effect: { kind: 'shell', action: 'newChat' } },
  // ── Engineering: developer mode only ──────────────────────────────────────
  { name: '/diagnostics', args: '', description: 'Show workspace diagnostics', effect: { kind: 'command', command: 'showDiagnostics' }, audience: 'developer' },
  { name: '/health', args: '', description: 'Check Brain service health', effect: { kind: 'command', command: 'health' }, audience: 'developer' },
  { name: '/policy', args: '', description: 'Choose the execution policy', effect: { kind: 'command', command: 'executionPolicy' }, audience: 'developer' },
  { name: '/approved', args: '', description: 'Answer only from the approved semantic index', effect: { kind: 'shell', action: 'sourceMode:approved' }, audience: 'developer' },
  { name: '/workspace', args: '', description: 'Answer from the current checkout, not the approved index', effect: { kind: 'shell', action: 'sourceMode:workspace' }, audience: 'developer' },
  { name: '/noevidence', args: '', description: 'Answer without reading the repository at all', effect: { kind: 'shell', action: 'sourceMode:none' }, audience: 'developer' },
  { name: '/agent', args: '', description: 'Open the governed Agent Workspace', effect: { kind: 'shell', action: 'tab:agent' }, audience: 'developer' },
  { name: '/history', args: '', description: 'Open the evidence-only Audit Trail', effect: { kind: 'shell', action: 'tab:audit' }, audience: 'developer' },
];

/** The palette for a mode. Product mode never sees the engineering entries. */
export function slashCommandsFor(developerMode: boolean): SlashCommand[] {
  return SLASH_COMMANDS.filter((command) => developerMode || command.audience !== 'developer');
}

export function matchSlashCommands(query: string, developerMode = true): SlashCommand[] {
  const catalogue = slashCommandsFor(developerMode);
  const needle = query.replace(/^\//, '').toLowerCase();
  if (!needle) return catalogue;
  return catalogue.filter(
    (command) => command.name.slice(1).toLowerCase().startsWith(needle) || command.description.toLowerCase().includes(needle),
  );
}

/**
 * Evidence-source selector — a DETERMINISTIC control, not a phrase the model reads.
 *
 * `approved` makes the turn answerable only from the approved semantic index: the
 * Brain withholds every working-tree tool and refuses rather than substituting
 * unapproved checkout content. It is a selector rather than a parsed instruction
 * because a governance boundary that depended on wording ("using only the approved
 * index...") would be a boundary in name only — that is exactly how a request for
 * approved-index-only analysis was answered from three `package.json` files.
 */
export const SOURCE_MODE_OPTIONS = [
  {
    value: 'auto',
    label: 'Auto evidence',
    hint: 'Approved index when it fits, working tree otherwise — the source is always stated with the answer',
    /** `false` = an ordinary preference; `true` = a governance mode the Brain enforces. */
    governed: false,
  },
  {
    value: 'approved',
    label: 'Approved index',
    hint: 'Answer only from the approved semantic index; refuse rather than use unapproved working-tree code',
    governed: true,
  },
  {
    value: 'workspace',
    label: 'Current workspace',
    hint: 'Force the current checkout as the evidence source; the approved index is not consulted',
    governed: true,
  },
  {
    value: 'none',
    label: 'No repository evidence',
    hint: 'Answer without consulting the repository at all; repository tools are withheld',
    governed: true,
  },
] as const;

export type SourceMode = (typeof SOURCE_MODE_OPTIONS)[number]['value'];

/** True when the turn must be answered from approved evidence alone. */
export function requiresApprovedEvidence(mode: string | undefined): boolean {
  return mode === 'approved';
}

/**
 * The wire value for a selector state.
 *
 * Identity by design — the UI label and the protocol value must not drift, so the
 * selector stores the protocol value itself rather than a display string that has
 * to be translated. Anything unrecognised degrades to `auto`, which is the only
 * mode that makes no governance claim.
 */
export function groundingModeOf(mode: string | undefined): SourceMode {
  return SOURCE_MODE_OPTIONS.some((o) => o.value === mode) ? (mode as SourceMode) : 'auto';
}

/** True when the selected mode is an enforced governance state, not a preference. */
export function isGovernedMode(mode: string | undefined): boolean {
  return SOURCE_MODE_OPTIONS.find((o) => o.value === mode)?.governed ?? false;
}

/** Host-rendered provenance line. The MODEL never decides whether this appears —
 * an instruction to "say you used the working tree" is not an enforceable
 * disclosure. Rendered by the host from the decision the Brain reported. */
export function sourceModeBadge(
  decision:
    | { sourceMode?: string; requestedMode?: string; forced?: boolean; indexVersion?: number; indexedBranch?: string; currentBranch?: string }
    | undefined,
): string {
  if (!decision?.sourceMode) return '';
  if (decision.sourceMode === 'none') return 'Source mode: No repository evidence';
  if (decision.sourceMode === 'approved-index') {
    const version = decision.indexVersion !== undefined ? ` v${decision.indexVersion}` : '';
    const diverged =
      decision.indexedBranch && decision.currentBranch && decision.indexedBranch !== decision.currentBranch
        ? ` — indexed from \`${decision.indexedBranch}\`, checkout is \`${decision.currentBranch}\``
        : '';
    return `Source mode: Approved index${version}${diverged}`;
  }
  // A FALLBACK is not the same statement as a deliberate choice: `auto` landing on
  // the checkout must not read as though the operator selected it.
  if (decision.forced === false && decision.requestedMode === 'auto') {
    return 'Source mode: Working tree (no approved evidence matched)';
  }
  return 'Source mode: Current workspace';
}

/**
 * Live-knowledge selector options — the SECOND, independent evidence dimension.
 *
 * Repository grounding answers "what repository material may be used"; this answers
 * "may information from outside the repository be consulted, and from which trust
 * class". Neither implies the other, so the two controls are separate and never
 * mutate one another.
 *
 * `web` is labelled honestly. No general-web provider ships yet, so selecting it
 * gets authoritative Tier 1 connectors and says so — a control that promised broad
 * web coverage while delivering seven first-party APIs would be a worse lie than
 * offering no web mode at all.
 */
export const LIVE_MODE_OPTIONS = [
  {
    value: 'off',
    label: 'Live knowledge off',
    hint: 'No external lookup of any kind; nothing leaves this machine for this turn',
    governed: false,
  },
  {
    value: 'official',
    label: 'Official sources',
    hint: 'Authoritative first-party sources only — official APIs, registries, releases, advisories and vendor documentation',
    governed: true,
  },
  {
    value: 'web',
    label: 'Web research',
    hint: 'Authoritative sources only while no general web provider is configured; the trust of each source is disclosed',
    governed: true,
  },
] as const;

export type LiveMode = (typeof LIVE_MODE_OPTIONS)[number]['value'];

/**
 * The wire value for a live-knowledge selector state.
 *
 * Fails CLOSED to `off`, deliberately unlike {@link groundingModeOf} which defaults to
 * `auto`. There the default is the prior behaviour; here anything but `off` would grant
 * network egress to a turn that never asked for it.
 */
export function liveModeOf(mode: string | undefined): LiveMode {
  return LIVE_MODE_OPTIONS.some((o) => o.value === mode) ? (mode as LiveMode) : 'off';
}

/** True when the live-knowledge selection permits any external lookup. */
export function permitsLiveLookup(mode: string | undefined): boolean {
  return liveModeOf(mode) !== 'off';
}

/**
 * Host-rendered live-knowledge provenance, built from the Brain's frame.
 *
 * A SEPARATE frame from {@link sourceModeBadge}: the two dimensions are independent, so
 * collapsing them into one line would make "no repository evidence" and "no external
 * evidence" indistinguishable. The model never sees these labels and cannot alter them.
 */
export function liveKnowledgeBadge(
  frame:
    | {
        headline?: string;
        checkedAt?: string;
        sourcesConsulted?: number;
        sourcesAccepted?: number;
        citations?: Array<{
          sourceId?: string;
          title?: string;
          safeUrl?: string;
          domain?: string;
          trustTier?: number;
          connectorId?: string;
          publishedAt?: string;
          retrievedAt?: string;
          contentHash?: string;
        }>;
        unavailable?: Array<{ connectorId?: string; reason?: string; detail?: string }>;
      }
    | undefined,
): string[] {
  if (!frame?.headline) return [];
  const lines = [frame.headline];
  if (frame.checkedAt) lines.push(`Checked: ${frame.checkedAt}`);
  if (typeof frame.sourcesAccepted === 'number') lines.push(`Sources accepted: ${frame.sourcesAccepted}`);
  // Broad-web coverage is absent until a general provider exists, and the frame says so
  // rather than leaving the operator to infer it from a headline.
  if (/Authoritative sources only/.test(frame.headline)) lines.push('General web provider: Not configured');
  for (const c of frame.citations ?? []) {
    if (!c.sourceId || !c.safeUrl) continue;
    const tier = c.trustTier !== undefined ? ` · tier ${c.trustTier}` : '';
    const when = c.publishedAt ?? c.retrievedAt;
    lines.push(`  [${c.sourceId}] ${c.title ?? c.domain ?? c.sourceId} — ${c.safeUrl}${tier}${when ? ` · ${when}` : ''}`);
  }
  for (const u of frame.unavailable ?? []) {
    if (u.connectorId) lines.push(`  unavailable: ${u.connectorId} (${u.reason ?? 'unknown'})${u.detail ? ` — ${u.detail}` : ''}`);
  }
  return lines;
}

/** Operator confirmation when the live-knowledge mode changes. */
export function liveModeConfirmation(mode: string | undefined): string {
  switch (liveModeOf(mode)) {
    case 'official':
      return 'Live knowledge set to **official sources**. Only authoritative first-party sources are accepted — official APIs, registries, releases, advisories and allowlisted vendor documentation. Nothing else is consulted, and when no authoritative source answers, the turn says so rather than widening.';
    case 'web':
      return 'Live knowledge set to **web research**. No general web provider is configured yet, so this currently consults the same authoritative sources as official mode and discloses that broad web coverage is unavailable.';
    default:
      return 'Live knowledge set to **off**. No external lookup of any kind will be performed and nothing leaves this machine for the next turn.';
  }
}

/** Model/routing selector options. `auto` lets the engine's router decide. */
export const ROUTING_OPTIONS = [
  // "Auto model" rather than "Auto": two adjacent selects both reading "Auto" gave
  // no way to tell the model picker from the evidence picker while collapsed.
  { value: 'auto', label: 'Auto model' },
  { value: 'cheap', label: 'Fast' },
  { value: 'default', label: 'Balanced' },
  { value: 'premium', label: 'Deep' },
] as const;

/**
 * Operator confirmation when the evidence mode changes.
 *
 * Each mode states what it ENFORCES, not just its name: a governance control the
 * operator cannot describe back is not a control they can rely on.
 */
export function sourceModeConfirmation(mode: string | undefined, branch?: string): string {
  const where = branch ? ` (checkout \`${branch}\`)` : '';
  switch (groundingModeOf(mode)) {
    case 'approved':
      return `Evidence source set to **approved index only**${where}. Requests the approved index cannot support will be refused rather than answered from working-tree code.`;
    case 'workspace':
      return `Evidence source set to **current workspace**${where}. Answers come from the checkout, and the approved index is not consulted — so they are not reviewed evidence.`;
    case 'none':
      return 'Evidence source set to **no repository evidence**. The repository will not be read at all and repository tools are withheld; answers come from general knowledge only.';
    default:
      return 'Evidence source set to **auto**. The source of each answer is stated with it.';
  }
}
