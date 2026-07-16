import * as vscode from 'vscode';
import { WorkspaceController } from './workspaceController.js';
import { deleteScopeFor, type WorkspacePanelModel, type RootFolder } from './workspaceViewModel.js';
import { isPilotError } from '@migrapilot/pilot-client';

export interface WorkspaceViewDeps {
  controller: WorkspaceController;
  output: vscode.OutputChannel;
}

/**
 * The "MigraAI Workspace" panel — an operational view of the one product object
 * (the workspace) and thin controls over the engine's workspace endpoints. It is
 * read-only until the operator triggers an action, and every action re-reads the
 * AUTHORITATIVE engine state afterward (a 200 is never treated as "ready").
 *
 * The panel never reconstructs workspace state, never shows internal ids, and
 * shows raw engine JSON only through the explicit Diagnostics action.
 */
export class MigraPilotWorkspaceViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'migrapilot.workspace';
  private view?: vscode.WebviewView;
  /** The last authoritative model — the source for Approve's version binding and
   * for action enablement. Undefined = no workspace open yet. */
  private current?: WorkspacePanelModel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: WorkspaceViewDeps,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = this.render(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message: unknown) => this.onMessage(message));
    // Re-read when the panel becomes visible again (state may have changed).
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.refresh();
    });
  }

  private async onMessage(message: unknown): Promise<void> {
    const msg = message as { type?: string };
    switch (msg?.type) {
      case 'ready':
      case 'refresh':
        return this.refresh();
      case 'open':
        return this.doOpen();
      case 'sync':
        return this.doSync();
      case 'rebuild':
        return this.doRebuild();
      case 'approve':
        return this.doApprove();
      case 'changeMemory':
        return this.doChangeMemory();
      case 'diagnostics':
        return this.doDiagnostics();
      case 'delete':
        return this.doDelete();
    }
  }

  /** Re-read the current workspace (if any) and push it to the webview. */
  async refresh(): Promise<void> {
    if (!this.view) return;
    if (!this.current) {
      this.post();
      return;
    }
    try {
      this.current = await this.deps.controller.get(this.current.workspaceId);
    } catch (err) {
      this.notify(this.reason(err), 'error');
    }
    this.post();
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  private async doOpen(): Promise<void> {
    const res = this.deps.controller.resolveRoot();
    let root: string;
    if (res.kind === 'none') {
      void vscode.window.showWarningMessage('Open a folder in VS Code to use MigraAI Workspace.');
      return;
    }
    if (res.kind === 'root') {
      root = res.root;
    } else {
      // Multiple folders open → require an explicit choice; never infer one.
      const pick = await vscode.window.showQuickPick(
        res.options.map((o: RootFolder) => ({ label: o.name, description: o.fsPath, fsPath: o.fsPath })),
        { title: 'MigraAI Workspace — select the workspace root', placeHolder: 'Multiple folders are open; choose the workspace root to open' },
      );
      if (!pick) return; // cancelled — do nothing
      root = pick.fsPath;
    }
    await this.busy('Opening workspace…', async () => {
      this.current = await this.deps.controller.open(root);
      this.notify(`Opened ${this.current.name} — ${this.current.status.label}.`, 'info');
    });
  }

  private async doSync(): Promise<void> {
    const model = this.current;
    if (!model) return;
    const before = { files: model.indexFiles, chunks: model.indexChunks };
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Syncing ${model.name}…`, cancellable: true },
      async (_progress, token) => {
        const ac = new AbortController();
        token.onCancellationRequested(() => ac.abort());
        try {
          const next = await this.deps.controller.sync(model.workspaceId, ac.signal);
          this.current = next; // AUTHORITATIVE — status comes from the engine, not the 200.
          const df = next.indexFiles - before.files;
          const dc = next.indexChunks - before.chunks;
          const delta = `${next.indexFiles} files (${sign(df)}), ${next.indexChunks} chunks (${sign(dc)})`;
          const approval = next.actions.approve ? ' Approval required before it backs chat.' : '';
          this.notify(`Sync complete — ${delta}. Status: ${next.status.label}.${approval}`, 'info');
        } catch (err) {
          if (this.isCancel(err)) {
            // Cancellation must never report completion — refresh from the engine.
            this.current = await this.deps.controller.get(model.workspaceId).catch(() => this.current);
            this.notify('Sync cancelled — no changes applied. Panel refreshed from engine state.', 'warn');
          } else {
            this.notify(this.reason(err), 'error');
          }
        }
      },
    );
    this.post();
  }

  private async doRebuild(): Promise<void> {
    const model = this.current;
    if (!model) return;
    const choice = await vscode.window.showWarningMessage(
      `Rebuild "${model.name}" — full re-index from scratch?`,
      { modal: true, detail: 'This drops the current index and re-embeds every file. It can be expensive, and the rebuilt index is NOT approved automatically — you must review and approve it before it backs chat.' },
      'Rebuild',
    );
    if (choice !== 'Rebuild') return;
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Rebuilding ${model.name}…`, cancellable: true },
      async (_progress, token) => {
        const ac = new AbortController();
        token.onCancellationRequested(() => ac.abort());
        try {
          const next = await this.deps.controller.rebuild(model.workspaceId, ac.signal);
          this.current = next;
          this.notify(`Rebuilt — ${next.indexChunks} chunks. Status: ${next.status.label}. Approval required.`, 'info');
        } catch (err) {
          if (this.isCancel(err)) {
            this.current = await this.deps.controller.get(model.workspaceId).catch(() => this.current);
            this.notify('Rebuild cancelled — panel refreshed from engine state.', 'warn');
          } else {
            this.notify(this.reason(err), 'error');
          }
        }
      },
    );
    this.post();
  }

  private async doApprove(): Promise<void> {
    const model = this.current;
    if (!model || !model.actions.approve) return;
    const id = model.workspaceId;
    const version = model.indexVersion; // bind to the EXACT observed version
    const choice = await vscode.window.showInformationMessage(
      `Approve the semantic index for "${model.name}"?`,
      { modal: true, detail: `This promotes the current index (${model.indexChunks} chunks) to back production chat retrieval. Only approve content you have reviewed. If the index changed since you last synced, approval will be refused so you can review the new version.` },
      'Approve',
    );
    if (choice !== 'Approve') return;
    try {
      this.current = await this.deps.controller.approve(id, version);
      this.notify(`Index approved — ${this.current.name} is ${this.current.status.label}.`, 'info');
    } catch (err) {
      if (isPilotError(err) && err.code === 'INVALID_STATE') {
        // Stale version — the engine refused because the index changed.
        this.current = await this.deps.controller.get(id).catch(() => this.current);
        this.notify('The index changed since you viewed it — review the new version and approve again.', 'warn');
      } else {
        this.notify(this.reason(err), 'error');
      }
    }
    this.post();
  }

  private async doChangeMemory(): Promise<void> {
    const model = this.current;
    if (!model) return;
    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Off', description: 'No conversation memory', mode: 'off' as const },
        { label: 'Session', description: 'In-memory for this session only', mode: 'session' as const },
        { label: 'Durable', description: 'Persisted across restarts', mode: 'durable' as const },
      ],
      { title: `Memory mode for ${model.name}`, placeHolder: `Current: ${model.memoryMode}` },
    );
    if (!pick || pick.mode === model.memoryMode) return;
    try {
      this.current = await this.deps.controller.setMemoryMode(model.workspaceId, pick.mode);
      this.notify(`Memory mode set to ${pick.mode}.`, 'info');
    } catch (err) {
      this.notify(this.reason(err), 'error');
    }
    this.post();
  }

  private async doDiagnostics(): Promise<void> {
    const model = this.current;
    if (!model) {
      void vscode.window.showInformationMessage('Open a workspace first to view its diagnostics.');
      return;
    }
    try {
      const raw = await this.deps.controller.getRaw(model.workspaceId);
      const doc = await vscode.workspace.openTextDocument({ language: 'json', content: JSON.stringify(raw, null, 2) });
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch (err) {
      this.notify(this.reason(err), 'error');
    }
  }

  private async doDelete(): Promise<void> {
    const model = this.current;
    if (!model) return;
    const scope = deleteScopeFor(model.name);
    const detail = `Removes:\n• ${scope.removes.join('\n• ')}\n\nKept (scope-owned, not deleted):\n• ${scope.keeps.join('\n• ')}`;
    const choice = await vscode.window.showWarningMessage(`${scope.confirmLabel}?`, { modal: true, detail }, 'Delete');
    if (choice !== 'Delete') return;
    try {
      await this.deps.controller.delete(model.workspaceId);
      this.current = undefined;
      this.notify(`Deleted ${model.name}. Conversation and durable memory were kept.`, 'info');
    } catch (err) {
      this.notify(this.reason(err), 'error');
    }
    this.post();
  }

  // ── plumbing ────────────────────────────────────────────────────────────────

  private async busy(label: string, fn: () => Promise<void>): Promise<void> {
    this.view?.webview.postMessage({ type: 'busy', label });
    try {
      await fn();
    } catch (err) {
      this.notify(this.reason(err), 'error');
    }
    this.post();
  }

  private post(): void {
    if (!this.view) return;
    if (this.current) this.view.webview.postMessage({ type: 'model', model: this.current });
    else this.view.webview.postMessage({ type: 'empty' });
  }

  private notify(text: string, level: 'info' | 'warn' | 'error'): void {
    this.deps.output.appendLine(`[workspace] ${text}`);
    this.view?.webview.postMessage({ type: 'notice', level, text });
  }

  private isCancel(err: unknown): boolean {
    return isPilotError(err) && err.code === 'CANCELLED';
  }

  /** A user-safe reason string (never a raw provider body / secret). */
  private reason(err: unknown): string {
    if (isPilotError(err)) return err.message;
    return 'The MigraAI engine could not complete the request.';
  }

  private render(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = ["default-src 'none'", `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 10px; }
  h1 { font-size: 13px; margin: 2px 0 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .7; margin: 14px 0 6px; }
  .pill { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--vscode-panel-border); }
  .pill.ok { color: var(--vscode-testing-iconPassed, #3fb950); border-color: currentColor; }
  .pill.warn { color: var(--vscode-editorWarning-foreground, #d7ba7d); border-color: currentColor; }
  .pill.error { color: var(--vscode-testing-iconFailed, #f85149); border-color: currentColor; }
  .pill.info { color: var(--vscode-charts-blue, #4aa5f0); border-color: currentColor; }
  .pill.muted { opacity: .6; }
  .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 3px 0; border-bottom: 1px solid var(--vscode-panel-border); }
  .row .label { opacity: .7; white-space: nowrap; }
  .row .value { text-align: right; word-break: break-word; }
  .value.muted { opacity: .55; }
  .value.warn { color: var(--vscode-editorWarning-foreground, #d7ba7d); }
  .value.error { color: var(--vscode-testing-iconFailed, #f85149); }
  .value.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 12px; }
  button { padding: 7px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; cursor: pointer; background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-foreground); font: inherit; }
  button:hover:not(:disabled) { background: var(--vscode-list-hoverBackground); }
  button:disabled { opacity: .4; cursor: default; }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; font-weight: 600; }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.danger { color: var(--vscode-testing-iconFailed, #f85149); }
  button.span2 { grid-column: span 2; }
  .empty { opacity: .8; text-align: center; padding: 24px 8px; }
  .notice { margin-top: 10px; padding: 6px 8px; border-radius: 4px; border-left: 3px solid var(--vscode-panel-border); font-size: 12px; display: none; }
  .notice.show { display: block; }
  .notice.info { border-left-color: var(--vscode-charts-blue, #4aa5f0); }
  .notice.warn { border-left-color: var(--vscode-editorWarning-foreground, #d7ba7d); }
  .notice.error { border-left-color: var(--vscode-testing-iconFailed, #f85149); }
  .busy { opacity: .8; padding: 16px 8px; text-align: center; }
</style>
</head>
<body>
  <div id="app"></div>
  <div class="notice" id="notice"></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');
  const notice = document.getElementById('notice');
  function esc(s) { return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function btn(id, label, cls, disabled) { return '<button data-act="'+id+'" class="'+(cls||'')+'"'+(disabled?' disabled':'')+'>'+esc(label)+'</button>'; }
  function renderEmpty() {
    app.innerHTML = '<div class="empty"><p>No workspace open.</p><p>Open the active VS Code workspace root to view its semantic index, memory, agents, and models.</p></div>'
      + '<div class="actions">' + btn('open','Open Workspace','primary span2') + btn('diagnostics','Diagnostics','', false) + btn('refresh','Refresh','', false) + '</div>';
  }
  function renderBusy(label) { app.innerHTML = '<div class="busy">'+esc(label||'Working…')+'</div>'; }
  function renderModel(m) {
    let html = '<h1><span>'+esc(m.name)+'</span><span class="pill '+esc(m.status.tone)+'">'+esc(m.status.label)+'</span></h1>';
    for (const section of m.sections) {
      html += '<h2>'+esc(section.title)+'</h2>';
      for (const r of section.rows) {
        html += '<div class="row"><span class="label">'+esc(r.label)+'</span><span class="value '+esc(r.tone||'')+'">'+esc(r.value)+'</span></div>';
      }
    }
    const a = m.actions;
    html += '<div class="actions">'
      + btn('sync','Sync Workspace','primary', !a.sync)
      + btn('approve','Approve Index','', !a.approve)
      + btn('rebuild','Rebuild Index','', !a.rebuild)
      + btn('changeMemory','Change Memory Mode','', !a.changeMemory)
      + btn('diagnostics','Diagnostics','', false)
      + btn('delete','Delete Workspace','danger', !a.delete)
      + btn('refresh','Refresh','span2', false)
      + '</div>';
    app.innerHTML = html;
  }
  app.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    vscode.postMessage({ type: b.dataset.act });
  });
  function showNotice(level, text) {
    notice.className = 'notice show ' + level;
    notice.textContent = text;
  }
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) return;
    if (msg.type === 'model') renderModel(msg.model);
    else if (msg.type === 'empty') renderEmpty();
    else if (msg.type === 'busy') renderBusy(msg.label);
    else if (msg.type === 'notice') showNotice(msg.level, msg.text);
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}

function sign(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 24; i += 1) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
