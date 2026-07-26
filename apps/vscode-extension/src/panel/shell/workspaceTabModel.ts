// MigraPilot Shell — the Workspace tab (MigraAI Workspace consolidation).
//
// Adapts the EXISTING `WorkspacePanelModel` — produced by the already-ratified
// `workspaceViewModel.ts` mapper — into the shell's display vocabulary. The
// engine→operator relabelling, tone assignment, credential stripping and action
// enablement all stay in that mapper; this module only re-dresses its output and
// derives the index-approval card. Nothing about workspace semantics is
// re-implemented here, so the migrated tab cannot drift from the surface it
// replaces.
//
// SECURITY / CONTRACT NOTE
//
// `WorkspacePanelModel` carries two INTERNAL fields that its own documentation
// marks "NOT rendered": `workspaceId` (action dispatch) and `indexVersion`
// (approval binding). They are deliberately absent from every type in this file,
// so they cannot reach a webview even by accident. The webview posts a bare
// intent and the HOST binds the approval to the exact version it observed —
// the same pattern the Agent Mode approval uses for its fingerprint.

import type { PanelActions, WorkspacePanelModel } from '../workspaceViewModel.js';
import { type ActionButton, type Badge, type Panel, type Row, type Tone } from './types.js';

/** Fields that must never appear in the posted Workspace tab state. */
export const WORKSPACE_DENY_LIST: readonly string[] = ['workspaceId', 'indexVersion'];

export interface IndexApprovalCard {
  /** `required` renders the governed approval card; `clear` is an all-good note. */
  state: 'required' | 'clear' | 'indexing' | 'not-indexed';
  heading: string;
  badge: Badge;
  /** Sanitized summary of what approval promotes. */
  rows: Row[];
  note: string;
  actions: ActionButton[];
}

export interface WorkspaceTabModel {
  state: 'ready' | 'empty' | 'disconnected' | 'loading';
  /** Workspace display name (never the absolute root). */
  name: string;
  status: Badge;
  /** The engine-derived sections, re-dressed as shell panels. */
  panels: Panel[];
  approval: IndexApprovalCard;
  /** Lifecycle actions (sync / rebuild / memory / diagnostics / delete). */
  actions: ActionButton[];
  /** Bounded operator guidance when the tab cannot show a workspace. */
  message?: string;
  /** Explains that this surface is the canonical home for the workflow. */
  note: string;
}

const CANONICAL_NOTE =
  'The MigraAI Workspace product object: semantic index, memory, agents, models and engine. Every action re-reads authoritative engine state — a 200 is never treated as "ready".';

/** Rows whose labels are absolute paths are reduced to a leaf segment, matching
 * the sanitation the rest of the shell applies. */
const PATH_ROWS = new Set(['Root']);

function leafPath(value: string): string {
  const normalized = value.replace(/[\\/]+$/, '');
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1]! : value;
}

/** No workspace opened yet / engine unreachable. */
export function emptyWorkspaceTab(message?: string, disconnected = false): WorkspaceTabModel {
  return {
    state: disconnected ? 'disconnected' : 'empty',
    name: '—',
    status: { text: 'No workspace', tone: 'muted', title: 'No MigraAI workspace is open in this window.' },
    panels: [],
    approval: {
      state: 'not-indexed',
      heading: 'NO INDEX',
      badge: { text: 'NOT INDEXED', tone: 'muted', title: 'Open the workspace to build a semantic index.' },
      rows: [],
      note: 'Open the workspace to register it with the engine and build a semantic index.',
      actions: [],
    },
    actions: [{ id: 'open', label: 'Open Workspace', kind: 'primary', icon: 'database' }],
    ...(message ? { message } : {}),
    note: CANONICAL_NOTE,
  };
}

export function loadingWorkspaceTab(): WorkspaceTabModel {
  const base = emptyWorkspaceTab('Reading authoritative workspace state…');
  return { ...base, state: 'loading', actions: [] };
}

export interface WorkspaceTabContext {
  /** The branch the working tree is on RIGHT NOW, from live Git inspection. */
  currentBranch?: string;
}

/**
 * Map the authoritative panel model onto the Workspace tab.
 *
 * Action ENABLEMENT is taken verbatim from `model.actions`, which the ratified
 * mapper derives from engine state (e.g. Approve only when there is an indexed,
 * not-yet-approved version).
 */
export function toWorkspaceTab(model: WorkspacePanelModel, context: WorkspaceTabContext = {}): WorkspaceTabModel {
  return {
    state: 'ready',
    name: model.name,
    status: { text: model.status.label, tone: model.status.tone as Tone, title: `Engine-reported workspace health: ${model.status.label}.` },
    panels: model.sections.map((section) => ({
      title: section.title,
      state: 'ready' as const,
      rows: section.title === 'Workspace' ? workspaceRows(section.rows, context) : section.rows.map(toShellRow),
    })),
    approval: toIndexApproval(model),
    actions: toLifecycleActions(model.actions),
    note: CANONICAL_NOTE,
  };
}

function toShellRow(row: { label: string; value: string; tone?: string }): Row {
  return {
    label: row.label,
    value: PATH_ROWS.has(row.label) ? leafPath(row.value) : row.value,
    ...(row.tone ? { tone: row.tone as Tone } : {}),
    ...(row.label === 'Root' || row.label === 'Git repo' ? { mono: true } : {}),
  };
}

/**
 * Disambiguate the two branches.
 *
 * The engine's `gitBranch` is the branch recorded when the workspace was LAST
 * SYNCHRONIZED — it is a property of the index, not of the checkout. Labelling it
 * plain "Branch" next to a Workspace Context panel showing the live branch made
 * the product look inconsistent when they legitimately differ.
 *
 * Both facts are preserved and labelled: neither value is overwritten, and a
 * divergence is called out because it means the index no longer reflects the
 * working tree.
 */
function workspaceRows(rows: ReadonlyArray<{ label: string; value: string; tone?: string }>, context: WorkspaceTabContext): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    if (row.label !== 'Branch') {
      out.push(toShellRow(row));
      continue;
    }
    const indexed = row.value;
    const current = context.currentBranch;
    const diverged = Boolean(current && indexed && indexed !== '—' && current !== indexed);
    out.push({
      label: 'Indexed branch',
      value: indexed,
      mono: true,
      ...(diverged ? { tone: 'warn' as Tone } : row.tone ? { tone: row.tone as Tone } : {}),
    });
    if (current) {
      out.push({ label: 'Current branch', value: current, mono: true, tone: diverged ? 'info' : 'muted' });
    }
    if (diverged) {
      out.push({
        label: 'Index freshness',
        value: 'Indexed on a different branch — sync to reindex the current one',
        tone: 'warn',
      });
    }
  }
  return out;
}

/**
 * The index-promotion approval.
 *
 * This is a SECOND approval boundary, independent of Agent Mode's command
 * approval: promoting an index decides what content backs production chat
 * retrieval. It is surfaced as its own governed card so it can never be
 * confused with, or satisfied by, a command approval.
 */
function toIndexApproval(model: WorkspacePanelModel): IndexApprovalCard {
  const indexed = model.indexChunks > 0;
  const rows: Row[] = [
    { label: 'Files', value: String(model.indexFiles) },
    { label: 'Chunks', value: String(model.indexChunks) },
  ];

  if (model.actions.approve) {
    return {
      state: 'required',
      heading: 'INDEX APPROVAL REQUIRED',
      badge: { text: 'NEEDS APPROVAL', tone: 'governed', title: 'The current index version has not been promoted to back chat retrieval.' },
      rows,
      note: 'Approving promotes the CURRENT index version to back production chat retrieval. Only approve content you have reviewed. If the index changed since you last looked, the engine refuses the approval so you can review the new version.',
      actions: [
        { id: 'approve', label: 'Approve Index', kind: 'governed', icon: 'shield' },
        { id: 'diagnostics', label: 'Inspect engine state', kind: 'secondary', icon: 'search' },
      ],
    };
  }

  if (!indexed) {
    return {
      state: 'not-indexed',
      heading: 'NO INDEX',
      badge: { text: 'NOT INDEXED', tone: 'muted', title: 'No chunks have been indexed for this workspace.' },
      rows,
      note: 'Sync the workspace to build a semantic index. A new index is never approved automatically.',
      actions: [],
    };
  }

  if (model.status.label === 'Syncing') {
    return {
      state: 'indexing',
      heading: 'INDEXING',
      badge: { text: 'SYNCING', tone: 'info', title: 'The engine is indexing this workspace.' },
      rows,
      note: 'Indexing is in progress. Approval becomes available once the engine reports a version.',
      actions: [],
    };
  }

  return {
    state: 'clear',
    heading: 'INDEX APPROVED',
    badge: { text: 'APPROVED', tone: 'ok', title: 'The current index version is approved and backs chat retrieval.' },
    rows,
    note: 'The current index version is approved. A rebuild or a further sync requires re-approval.',
    actions: [{ id: 'diagnostics', label: 'Inspect engine state', kind: 'secondary', icon: 'search' }],
  };
}

function toLifecycleActions(actions: PanelActions): ActionButton[] {
  return [
    {
      id: 'sync',
      label: 'Sync Workspace',
      kind: 'primary',
      icon: 'sync',
      disabled: !actions.sync,
      ...(actions.sync ? {} : { disabledReason: 'The engine is already indexing this workspace.' }),
    },
    {
      id: 'rebuild',
      label: 'Rebuild Index',
      kind: 'secondary',
      icon: 'database',
      disabled: !actions.rebuild,
      ...(actions.rebuild ? {} : { disabledReason: 'The engine is already indexing this workspace.' }),
    },
    {
      id: 'changeMemory',
      label: 'Change Memory Mode',
      kind: 'secondary',
      icon: 'history',
      disabled: !actions.changeMemory,
    },
    { id: 'diagnostics', label: 'Diagnostics', kind: 'secondary', icon: 'info' },
    { id: 'refreshWorkspace', label: 'Refresh', kind: 'secondary', icon: 'sync' },
    {
      id: 'delete',
      label: 'Delete Workspace',
      kind: 'danger',
      icon: 'circle-slash',
      disabled: !actions.delete,
    },
  ];
}

/** Intent ids the Workspace tab may dispatch. The host refuses anything else. */
export const WORKSPACE_INTENTS = [
  'open',
  'sync',
  'rebuild',
  'approve',
  'changeMemory',
  'diagnostics',
  'delete',
  'refreshWorkspace',
] as const;

export type WorkspaceIntent = (typeof WORKSPACE_INTENTS)[number];

export function isWorkspaceIntent(value: unknown): value is WorkspaceIntent {
  return typeof value === 'string' && (WORKSPACE_INTENTS as readonly string[]).includes(value);
}
