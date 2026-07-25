// MigraPilot Shell — MigraAI Workspace action orchestration.
//
// View-agnostic choreography for the workspace lifecycle: confirm → call the
// controller → interpret the AUTHORITATIVE result. Extracted so the Command
// Center's Workspace tab runs the exact same flow the standalone panel runs,
// rather than a re-implementation that could drift while both surfaces coexist.
//
// The two behaviours that must not change are preserved verbatim:
//
//  * APPROVAL BINDING — approve() is bound to the index version observed at the
//    moment the operator clicked. A version that moved underneath them is
//    refused by the engine (INVALID_STATE), which is surfaced as "review the new
//    version" rather than retried. The version is read from host-held state; it
//    is never accepted from a webview.
//  * DESTRUCTIVE SCOPE — delete() is confirmed with `deleteScopeFor()`, which
//    spells out what is removed AND what is kept, so a delete can never be
//    broader than the operator understood.
//
// Cancellation never reports completion: a cancelled sync/rebuild re-reads
// engine state instead of claiming success.

import * as vscode from 'vscode';
import { isPilotError } from '@migrapilot/pilot-client';
import type { WorkspaceController } from '../workspaceController.js';
import { type RootFolder, type WorkspacePanelModel, deleteScopeFor } from '../workspaceViewModel.js';

export type Notice = (text: string, level: 'info' | 'warn' | 'error') => void;

export interface WorkspaceActionDeps {
  controller: WorkspaceController;
  notice: Notice;
  output: vscode.OutputChannel;
}

/** Outcome of an action: the new authoritative model, or an explicit absence. */
export interface WorkspaceActionResult {
  /** `undefined` after a delete, or when nothing is open. */
  model?: WorkspacePanelModel;
  /** True when the operator cancelled a modal/picker — nothing happened. */
  cancelled?: boolean;
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** A user-safe reason (never a raw provider body / secret). */
function reason(error: unknown): string {
  if (isPilotError(error)) return error.message.slice(0, 300);
  return 'The MigraAI engine could not complete the request.';
}

function isCancel(error: unknown): boolean {
  return isPilotError(error) && error.code === 'CANCELLED';
}

/**
 * Open the workspace at the resolved root. Multiple folders require an EXPLICIT
 * choice — a root is never inferred.
 */
export async function openWorkspace(deps: WorkspaceActionDeps): Promise<WorkspaceActionResult> {
  const resolution = deps.controller.resolveRoot();
  let root: string;
  if (resolution.kind === 'none') {
    deps.notice('Open a folder in VS Code to use MigraAI Workspace.', 'warn');
    return { cancelled: true };
  }
  if (resolution.kind === 'root') {
    root = resolution.root;
  } else {
    const pick = await vscode.window.showQuickPick(
      resolution.options.map((option: RootFolder) => ({ label: option.name, description: option.fsPath, fsPath: option.fsPath })),
      {
        title: 'MigraAI Workspace — select the workspace root',
        placeHolder: 'Multiple folders are open; choose the workspace root to open',
      },
    );
    if (!pick) return { cancelled: true };
    root = pick.fsPath;
  }
  try {
    const model = await deps.controller.open(root);
    deps.notice(`Opened ${model.name} — ${model.status.label}.`, 'info');
    return { model };
  } catch (error) {
    deps.notice(reason(error), 'error');
    return {};
  }
}

export async function refreshWorkspace(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  try {
    return { model: await deps.controller.get(current.workspaceId) };
  } catch (error) {
    deps.notice(reason(error), 'error');
    return { model: current };
  }
}

/** Incremental re-index. Cancellable; a cancelled run re-reads engine state. */
export async function syncWorkspace(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  const before = { files: current.indexFiles, chunks: current.indexChunks };
  let result: WorkspaceActionResult = { model: current };
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Syncing ${current.name}…`, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      try {
        const next = await deps.controller.sync(current.workspaceId, controller.signal);
        const df = next.indexFiles - before.files;
        const dc = next.indexChunks - before.chunks;
        const delta = `${next.indexFiles} files (${sign(df)}), ${next.indexChunks} chunks (${sign(dc)})`;
        const approval = next.actions.approve ? ' Approval required before it backs chat.' : '';
        deps.notice(`Sync complete — ${delta}. Status: ${next.status.label}.${approval}`, 'info');
        result = { model: next };
      } catch (error) {
        if (isCancel(error)) {
          const refreshed = await deps.controller.get(current.workspaceId).catch(() => current);
          deps.notice('Sync cancelled — no changes applied. Panel refreshed from engine state.', 'warn');
          result = { model: refreshed, cancelled: true };
          return;
        }
        deps.notice(reason(error), 'error');
        result = { model: current };
      }
    },
  );
  return result;
}

/** Full re-index. Modal-confirmed: expensive AND the result needs re-approval. */
export async function rebuildWorkspace(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  const choice = await vscode.window.showWarningMessage(
    `Rebuild "${current.name}" — full re-index from scratch?`,
    {
      modal: true,
      detail:
        'This drops the current index and re-embeds every file. It can be expensive, and the rebuilt index is NOT approved automatically — you must review and approve it before it backs chat.',
    },
    'Rebuild',
  );
  if (choice !== 'Rebuild') return { model: current, cancelled: true };

  let result: WorkspaceActionResult = { model: current };
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Rebuilding ${current.name}…`, cancellable: true },
    async (_progress, token) => {
      const controller = new AbortController();
      token.onCancellationRequested(() => controller.abort());
      try {
        const next = await deps.controller.rebuild(current.workspaceId, controller.signal);
        deps.notice(`Rebuilt — ${next.indexChunks} chunks. Status: ${next.status.label}. Approval required.`, 'info');
        result = { model: next };
      } catch (error) {
        if (isCancel(error)) {
          const refreshed = await deps.controller.get(current.workspaceId).catch(() => current);
          deps.notice('Rebuild cancelled — panel refreshed from engine state.', 'warn');
          result = { model: refreshed, cancelled: true };
          return;
        }
        deps.notice(reason(error), 'error');
        result = { model: current };
      }
    },
  );
  return result;
}

/**
 * Promote the CURRENT index version.
 *
 * The version is captured from host-held authoritative state before the modal,
 * so approving what you reviewed is guaranteed: if the index moved while the
 * modal was open, the engine refuses with INVALID_STATE and the operator is
 * asked to review the new version instead.
 */
export async function approveWorkspaceIndex(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  if (!current.actions.approve) {
    deps.notice('There is no index version awaiting approval.', 'warn');
    return { model: current, cancelled: true };
  }
  const id = current.workspaceId;
  const version = current.indexVersion; // bind to the EXACT observed version
  const choice = await vscode.window.showInformationMessage(
    `Approve the semantic index for "${current.name}"?`,
    {
      modal: true,
      detail: `This promotes the current index (${current.indexChunks} chunks) to back production chat retrieval. Only approve content you have reviewed. If the index changed since you last synced, approval will be refused so you can review the new version.`,
    },
    'Approve',
  );
  if (choice !== 'Approve') return { model: current, cancelled: true };

  try {
    const next = await deps.controller.approve(id, version);
    deps.notice(`Index approved — ${next.name} is ${next.status.label}.`, 'info');
    return { model: next };
  } catch (error) {
    if (isPilotError(error) && error.code === 'INVALID_STATE') {
      const refreshed = await deps.controller.get(id).catch(() => current);
      deps.notice('The index changed since you viewed it — review the new version and approve again.', 'warn');
      return { model: refreshed };
    }
    deps.notice(reason(error), 'error');
    return { model: current };
  }
}

export async function changeWorkspaceMemory(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: 'Off', description: 'No conversation memory', mode: 'off' as const },
      { label: 'Session', description: 'In-memory for this session only', mode: 'session' as const },
      { label: 'Durable', description: 'Persisted across restarts', mode: 'durable' as const },
    ],
    { title: `Memory mode for ${current.name}`, placeHolder: `Current: ${current.memoryMode}` },
  );
  if (!pick || pick.mode === current.memoryMode) return { model: current, cancelled: true };
  try {
    const next = await deps.controller.setMemoryMode(current.workspaceId, pick.mode);
    deps.notice(`Memory mode set to ${pick.mode}.`, 'info');
    return { model: next };
  } catch (error) {
    deps.notice(reason(error), 'error');
    return { model: current };
  }
}

/** Raw engine state, opened as a read-only document via an EXPLICIT action. */
export async function showWorkspaceDiagnostics(deps: WorkspaceActionDeps, current: WorkspacePanelModel | undefined): Promise<void> {
  if (!current) {
    deps.notice('Open a workspace first to view its diagnostics.', 'warn');
    return;
  }
  try {
    const raw = await deps.controller.getRaw(current.workspaceId);
    const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(raw, null, 2) });
    await vscode.window.showTextDocument(doc, { preview: true });
  } catch (error) {
    deps.notice(reason(error), 'error');
  }
}

/** Destructive. The confirmation states what is removed AND what is kept. */
export async function deleteWorkspace(deps: WorkspaceActionDeps, current: WorkspacePanelModel): Promise<WorkspaceActionResult> {
  const scope = deleteScopeFor(current.name);
  const detail = `Removes:\n• ${scope.removes.join('\n• ')}\n\nKept (scope-owned, not deleted):\n• ${scope.keeps.join('\n• ')}`;
  const choice = await vscode.window.showWarningMessage(`${scope.confirmLabel}?`, { modal: true, detail }, 'Delete');
  if (choice !== 'Delete') return { model: current, cancelled: true };
  try {
    await deps.controller.delete(current.workspaceId);
    deps.notice(`Deleted ${current.name}. Conversation and durable memory were kept.`, 'info');
    return {};
  } catch (error) {
    deps.notice(reason(error), 'error');
    return { model: current };
  }
}
