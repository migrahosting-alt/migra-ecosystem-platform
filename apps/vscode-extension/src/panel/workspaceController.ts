// MigraAI Workspace — controller.
//
// vscode-light glue between the transport (MigraAiClient) and the panel/host
// tests. It owns NO state of its own beyond the injected root provider — every
// workspace fact comes from the engine and is mapped through toPanelModel, so
// the extension never reconstructs workspace state locally.
//
// Kept free of `vscode.window`/UI so host tests can drive the exact same
// open/sync/rebuild/approve/delete round-trips the panel performs.

import type { MigraAiClient, WorkspaceView, WorkspaceSummary, AgentDescriptor } from '../services/migraAiClient.js';
import {
  toPanelModel,
  resolveWorkspaceRoot,
  type WorkspacePanelModel,
  type RootFolder,
  type RootResolution,
} from './workspaceViewModel.js';

export class WorkspaceController {
  constructor(
    private readonly client: MigraAiClient,
    /** The currently-open VS Code workspace folders (name + fsPath). */
    private readonly folders: () => RootFolder[],
  ) {}

  /** Resolve the workspace root to open from the active VS Code folders. */
  resolveRoot(): RootResolution {
    return resolveWorkspaceRoot(this.folders());
  }

  /** Open (register/reuse) a workspace at an explicit root and return the model. */
  async open(root: string, opts: { name?: string; memoryMode?: 'off' | 'session' | 'durable' } = {}, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.openWorkspace({ root, ...opts }, signal), signal);
  }

  /** Refresh the authoritative view for a workspace. */
  async get(id: string, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.getWorkspace(id, signal), signal);
  }

  /** The raw engine view — used ONLY by the diagnostics escape hatch. */
  async getRaw(id: string, signal?: AbortSignal): Promise<WorkspaceView> {
    return this.client.getWorkspace(id, signal);
  }

  /** Sync (incremental). Returns the refreshed model from AUTHORITATIVE engine
   * state — the caller must not assume success means "ready". */
  async sync(id: string, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.syncWorkspace(id, signal), signal);
  }

  /** Full rebuild. The new index is experimental and never auto-approved. */
  async rebuild(id: string, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.rebuildWorkspace(id, signal), signal);
  }

  /** Approve the EXACT observed index version. A stale version is refused by the
   * engine (surfaced as a PilotError), never silently approved. */
  async approve(id: string, indexVersion: number, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.approveWorkspaceIndex(id, indexVersion, signal), signal);
  }

  /** Change the memory mode. */
  async setMemoryMode(id: string, memoryMode: 'off' | 'session' | 'durable', signal?: AbortSignal): Promise<WorkspacePanelModel> {
    return this.model(await this.client.patchWorkspace(id, { memoryMode }, signal), signal);
  }

  /** Delete the workspace registration + its index (scope-owned memory kept). */
  async delete(id: string, signal?: AbortSignal): Promise<{ ok: boolean }> {
    return this.client.deleteWorkspace(id, signal);
  }

  async list(signal?: AbortSignal): Promise<WorkspaceSummary[]> {
    return (await this.client.listWorkspaces(signal)).workspaces;
  }

  /** Merge the workspace view with the agent catalog (for read-only vs mutating
   * labels) into the sanitized panel model. Agent fetch is best-effort. */
  private async model(view: WorkspaceView, signal?: AbortSignal): Promise<WorkspacePanelModel> {
    let agents: AgentDescriptor[] | undefined;
    try {
      agents = (await this.client.listAgents({}, signal)).agents;
    } catch {
      // Best-effort — the panel still renders agent ids without the split.
    }
    return toPanelModel(view, { agents });
  }
}
