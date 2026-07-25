import * as vscode from 'vscode';
import type { MigraPilotShell } from './shell/shellProvider.js';

/**
 * The MigraPilot sidebar view — the LEFT NAVIGATION REGION of the redesigned
 * command centre (§3).
 *
 * It renders the navigation surface from the shell's single authoritative state
 * (conversations, Agent Mode with canonical counts, workspace summary, tools &
 * services, footer identity, status summary), so the sidebar and the Studio
 * editor panel can never disagree.
 *
 * The view id is unchanged (`migrapilot.sidebar`) so every existing
 * registration, focus command and test target keeps working. It still dispatches
 * only existing commands — the shell enforces the allow-list — and never mutates
 * backend state on its own.
 */
export class MigraPilotSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'migrapilot.sidebar';
  private view?: vscode.WebviewView;
  private attachment?: vscode.Disposable;

  constructor(private readonly shell: MigraPilotShell) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.attachment?.dispose();
    this.attachment = this.shell.attachNavigation(webviewView.webview);
    webviewView.onDidDispose(() => {
      this.attachment?.dispose();
      this.attachment = undefined;
      this.view = undefined;
    });
    // Re-read canonical state whenever the view becomes visible again.
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) void this.refresh();
    });
  }

  /** Re-read live state and push it to the navigation surface. */
  async refresh(): Promise<void> {
    if (!this.view) return;
    await this.shell.refresh();
  }
}
