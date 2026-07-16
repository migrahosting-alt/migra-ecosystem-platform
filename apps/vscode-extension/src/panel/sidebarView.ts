import * as vscode from 'vscode';
import { BrainClient } from '../services/brainClient.js';
import { type BackendRouter } from '../services/backendRouter.js';

/** State surfaced in the sidebar. All fields are display-only and secret-free by
 * construction (health status/version + resolved backend label + provider id). */
interface SidebarState {
  backend: string;
  backendClass: 'ok' | 'warn' | 'idle';
  health: string;
  healthClass: 'ok' | 'warn';
  version?: string;
  uptimeSec?: number;
  provider: string;
}

export interface SidebarDeps {
  brainClient: BrainClient;
  router: BackendRouter;
  providerKind: () => string;
}

/** A quick-action button rendered in the sidebar. `command` is executed via the
 * VS Code command registry — the same commands exposed in the Command Palette. */
interface QuickAction {
  command: string;
  label: string;
}

const ACTIONS: readonly QuickAction[] = [
  { command: 'migrapilot.health', label: 'Check Health' },
  { command: 'migrapilot.repairConnection', label: 'Repair Connection' },
  { command: 'migrapilot.explainSelection', label: 'Explain Selection' },
  { command: 'migrapilot.fixDiagnostics', label: 'Fix Diagnostics' },
  { command: 'migrapilot.generateTests', label: 'Generate Tests' },
  { command: 'migrapilot.generateCommit', label: 'Generate Commit Message' },
  { command: 'migrapilot.reviewApprovals', label: 'Review Pending Actions' },
  { command: 'migrapilot.showDiagnostics', label: 'Show Diagnostics' },
  { command: 'migrapilot.showBackendDiagnostics', label: 'Backend Diagnostics' },
  { command: 'migrapilot.showLogs', label: 'Show Logs' },
];

/** WebviewViewProvider that gives MigraPilot a first-class activity-bar panel:
 * live backend/health/provider status plus one-click access to every command.
 * It never mutates backend state on its own — buttons dispatch existing commands
 * and the panel re-reads state after each. */
export class MigraPilotSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'migrapilot.sidebar';
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly deps: SidebarDeps,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.render(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: unknown) => {
      const msg = message as { type?: string; command?: string };
      if (msg?.type === 'command' && typeof msg.command === 'string') {
        await vscode.commands.executeCommand(msg.command);
        await this.refresh();
      } else if (msg?.type === 'openChat') {
        // Open MigraPilot's own dedicated chat panel (not the shared chat view).
        await vscode.commands.executeCommand('migrapilot.openChat');
      } else if (msg?.type === 'refresh') {
        await this.refresh();
      }
    });

    void this.refresh();
  }

  /** Re-read live state and push it to the webview. Safe to call any time; a
   * no-op when the view has not been created yet. */
  async refresh(): Promise<void> {
    if (!this.view) {
      return;
    }
    const state = await this.collect();
    void this.view.webview.postMessage({ type: 'state', state });
  }

  private async collect(): Promise<SidebarState> {
    let health = 'offline';
    let healthClass: 'ok' | 'warn' = 'warn';
    let version: string | undefined;
    let uptimeSec: number | undefined;
    try {
      const h = await this.deps.brainClient.health();
      health = h.status;
      healthClass = h.status === 'ok' ? 'ok' : 'warn';
      version = h.version;
      uptimeSec = h.uptimeSec;
    } catch {
      // Unreachable brain — leave the warn/offline defaults.
    }
    const { backend, backendClass } = this.backendLabel();
    return { backend, backendClass, health, healthClass, version, uptimeSec, provider: this.deps.providerKind() };
  }

  private backendLabel(): { backend: string; backendClass: 'ok' | 'warn' | 'idle' } {
    const b = this.deps.router.current();
    if (!b) {
      return { backend: 'resolving…', backendClass: 'idle' };
    }
    if (b.kind === 'remote') {
      return { backend: 'pilot-api', backendClass: 'ok' };
    }
    if (b.kind === 'remote-unavailable') {
      return { backend: 'pilot-api (unavailable)', backendClass: 'warn' };
    }
    return { backend: 'local brain-service', backendClass: 'ok' };
  }

  private render(webview: vscode.Webview): string {
    const nonce = makeNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    const buttons = ACTIONS.map(
      (a) => `<button class="action" data-command="${a.command}">${escapeHtml(a.label)}</button>`,
    ).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px 10px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; opacity: .8; margin: 14px 0 6px; }
  .status { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; background: var(--vscode-editorWidget-background); }
  .label { opacity: .75; }
  .value { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .ok .dot { background: var(--vscode-testing-iconPassed, #3fb950); }
  .warn .dot { background: var(--vscode-testing-iconFailed, #f85149); }
  .idle .dot { background: var(--vscode-descriptionForeground); }
  .sub { opacity: .6; font-size: 11px; }
  button.primary { width: 100%; padding: 8px; margin: 4px 0 2px; border: none; border-radius: 4px; cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-weight: 600; }
  button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .actions { display: flex; flex-direction: column; gap: 4px; }
  button.action { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 6px 8px; border: 1px solid transparent; border-radius: 4px; cursor: pointer; background: transparent; color: var(--vscode-foreground); }
  button.action:hover { background: var(--vscode-list-hoverBackground); }
  .toolbar { display: flex; justify-content: flex-end; }
  button.refresh { background: transparent; border: none; color: var(--vscode-foreground); cursor: pointer; opacity: .7; padding: 2px 4px; }
  button.refresh:hover { opacity: 1; }
</style>
</head>
<body>
  <div class="toolbar"><button class="refresh" id="refresh" title="Refresh">↻</button></div>

  <button class="primary" id="openChat">Open MigraPilot Chat</button>

  <h2>Status</h2>
  <div class="status">
    <div class="row" id="backendRow"><span class="label">Backend</span><span class="value"><span class="dot"></span><span id="backend">…</span></span></div>
    <div class="row" id="healthRow"><span class="label">Brain</span><span class="value"><span class="dot"></span><span id="health">…</span></span></div>
    <div class="row"><span class="label">Provider</span><span class="value" id="provider">…</span></div>
  </div>
  <div class="sub" id="detail"></div>

  <h2>Actions</h2>
  <div class="actions">${buttons}</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  document.getElementById('openChat').addEventListener('click', () => vscode.postMessage({ type: 'openChat' }));
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  for (const el of document.querySelectorAll('button.action')) {
    el.addEventListener('click', () => vscode.postMessage({ type: 'command', command: el.dataset.command }));
  }
  function setRow(rowId, valueId, text, cls) {
    document.getElementById(valueId).textContent = text;
    const row = document.getElementById(rowId);
    row.classList.remove('ok', 'warn', 'idle');
    if (cls) row.classList.add(cls);
  }
  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg && msg.type === 'state') {
      const s = msg.state;
      setRow('backendRow', 'backend', s.backend, s.backendClass);
      setRow('healthRow', 'health', s.health, s.healthClass);
      document.getElementById('provider').textContent = s.provider;
      const parts = [];
      if (s.version) parts.push('v' + s.version);
      if (typeof s.uptimeSec === 'number') parts.push('uptime ' + s.uptimeSec + 's');
      document.getElementById('detail').textContent = parts.join(' · ');
    }
  });
  vscode.postMessage({ type: 'refresh' });
</script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 24; i += 1) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
