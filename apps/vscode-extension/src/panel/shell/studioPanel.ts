// MigraPilot Studio — the editor-panel host for the shell.
//
// A single reusable `WebviewPanel` in the editor area. This is the "premium"
// surface from the approved mockup: it gets the full editor width, so the wide
// three-region layout (navigation sidebar + main + context panel) is what the
// operator normally sees, while the same document degrades to the medium and
// narrow layouts when the column is small.
//
// `retainContextWhenHidden` keeps the transcript alive when the tab is in the
// background, matching the existing chat view's behaviour.

import * as vscode from 'vscode';
import type { ShellTabId } from './navigationModel.js';
import type { MigraPilotShell } from './shellProvider.js';

export class MigraPilotStudioPanel {
  public static readonly viewType = 'migrapilot.studio';
  private panel?: vscode.WebviewPanel;
  private attachment?: vscode.Disposable;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly shell: MigraPilotShell,
  ) {}

  /** Reveal the Studio, creating it on first use. Safe to call repeatedly. */
  async reveal(tab?: ShellTabId): Promise<void> {
    if (this.panel) {
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Active, false);
      if (tab) this.shell.showTab(tab);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      MigraPilotStudioPanel.viewType,
      'MigraPilot',
      { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [this.extensionUri],
      },
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.extensionUri, 'resources', 'migrapilot-icon.svg');
    // `compact: false` — the editor panel is the roomy surface.
    this.attachment = this.shell.attach(this.panel.webview, { compact: false });
    this.panel.onDidDispose(() => {
      this.attachment?.dispose();
      this.attachment = undefined;
      this.panel = undefined;
    });
    if (tab) this.shell.showTab(tab);
  }

  visible(): boolean {
    return this.panel?.visible === true;
  }

  dispose(): void {
    this.attachment?.dispose();
    this.panel?.dispose();
  }
}
