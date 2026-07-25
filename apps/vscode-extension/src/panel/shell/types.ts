// MigraPilot Shell — shared display vocabulary.
//
// Every model in this directory is PURE (no vscode import) so the whole display
// layer is unit-testable in plain Node, exactly like `workspaceViewModel.ts`.
//
// The vocabulary is deliberately small and serializable: the webview receives
// these structures over `postMessage` and renders them with a generic renderer.
// Display logic therefore lives in TypeScript (typed against the canonical
// protocol enums) instead of inside a large webview script.

/** Semantic tone. The stylesheet is the ONLY place that maps a tone to a colour,
 * so the palette contract (blue = navigation/inspection, orange = governance,
 * green = verified, red = failure) is enforced in one place. */
export type Tone =
  | 'neutral'
  | 'muted'
  | 'info' // electric blue — navigation + inspection
  | 'governed' // orange — Agent Mode, proposals, approval-required
  | 'ok' // green — verified health, trusted integrity, completed
  | 'warn' // amber — expired / degraded
  | 'error'; // red — failed, rejected, blocked, destructive

/** A labelled value. `value` is always a rendered string — never a raw object —
 * so nothing can leak by accidentally serializing a backend payload. */
export interface Row {
  label: string;
  value: string;
  tone?: Tone;
  /** Optional monospace hint (ids, versions, digests-free identifiers). */
  mono?: boolean;
}

export interface Badge {
  text: string;
  tone: Tone;
  /** Screen-reader elaboration when the short text is not self-describing. */
  title?: string;
}

/** Per-panel lifecycle. Every panel resolves its own state so one outage never
 * blanks the shell (§14). */
export type DataState =
  | 'loading'
  | 'ready'
  | 'empty'
  | 'disconnected'
  | 'unauthorized'
  | 'activation-required'
  | 'degraded'
  | 'error';

/** A panel that has not resolved yet renders this instead of rows. */
export interface PanelPlaceholder {
  state: Exclude<DataState, 'ready'>;
  /** Bounded, operator-facing text. Never a stack trace or raw backend body. */
  message: string;
  /** Command id for a safe retry, when one exists. */
  retryCommand?: string;
  retryLabel?: string;
}

export interface Panel {
  title: string;
  state: DataState;
  rows: Row[];
  placeholder?: PanelPlaceholder;
  /** Optional actions rendered at the bottom of the panel. */
  actions?: ActionButton[];
}

export type ActionKind = 'primary' | 'governed' | 'secondary' | 'danger';

export interface ActionButton {
  /** Intent id sent to the extension host. NEVER carries authority material. */
  id: string;
  label: string;
  kind: ActionKind;
  disabled?: boolean;
  /** Why the action is unavailable — surfaced as a tooltip/aria-description. */
  disabledReason?: string;
  /** Codicon id (rendered from the bundled VS Code codicon font when present). */
  icon?: string;
}

export const UNAVAILABLE = '—' as const;

/** Render an optional value honestly: unknown/absent becomes an em dash rather
 * than an invented "Available"/"Healthy" (§1, feedback: no fabricated state). */
export function display(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return UNAVAILABLE;
  const text = String(value).trim();
  return text.length ? text : UNAVAILABLE;
}

/** A row whose value may be missing; missing values are muted em dashes. */
export function optionalRow(label: string, value: string | number | undefined | null, tone?: Tone, mono?: boolean): Row {
  const has = value !== undefined && value !== null && String(value).trim().length > 0;
  return {
    label,
    value: display(value),
    ...(has ? (tone ? { tone } : {}) : { tone: 'muted' as Tone }),
    ...(mono ? { mono: true } : {}),
  };
}

/** Compact relative age used by conversation lists and activity feeds. */
export function relativeAge(at: number | undefined, now: number): string {
  if (!at) return UNAVAILABLE;
  const secs = Math.max(0, Math.round((now - at) / 1000));
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

/** Human duration for uptime / TTL. */
export function formatDuration(totalSeconds: number | undefined): string {
  if (totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return UNAVAILABLE;
  const secs = Math.floor(totalSeconds);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`;
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`;
  if (mins > 0) return `${mins}m ${String(secs % 60).padStart(2, '0')}s`;
  return `${secs}s`;
}

/**
 * Shorten a run/proposal identifier for display WITHOUT ever shortening a
 * security-relevant secret. Run ids are non-secret correlation handles, but a
 * full id is noise in a card header, so the card shows a visually shortened
 * form. The full id is still available in the run detail rows because operators
 * need it to correlate with audit evidence.
 */
export function shortenId(id: string | undefined): string {
  if (!id) return UNAVAILABLE;
  const trimmed = id.trim();
  if (trimmed.length <= 20) return trimmed;
  return `${trimmed.slice(0, 12)}…${trimmed.slice(-6)}`;
}
