import * as vscode from 'vscode';
import type { MigraPilotShell } from './shell/shellProvider.js';

/**
 * The MigraPilot sidebar view — THE PRODUCT, not a navigation region.
 *
 * This used to render the navigation surface as "the LEFT NAVIGATION REGION of
 * the redesigned command centre". That framing is the defect: a command centre
 * has a nav region and a main region, so opening MigraPilot produced TWO panels
 * — a list on one side and the place you actually type on the other. The verdict
 * from using it was "it still come as 2 panels", and before that "appears more a
 * developer console, not like claude, copilot, or codex". Two panels IS the
 * console; no comparable assistant has a nav region, because there is only one
 * thing to navigate to.
 *
 * So the sidebar now hosts the shell itself, compact. Opening MigraPilot gives
 * you a composer and your conversation, in one place, which is the shape every
 * tool it is measured against has.
 *
 * `compact` is a density HINT and nothing more — CSS decides the layout, and the
 * same document serves the editor panel. That is what keeps the two hosts from
 * drifting into two different products, which was the original and correct worry
 * behind rendering both from one authoritative state.
 *
 * The view id is unchanged (`migrapilot.sidebar`) so every existing
 * registration, focus command and test target keeps working. The editor panel
 * remains available for anyone who wants a wider surface; it is no longer
 * REQUIRED to reach the composer.
 */
export class MigraPilotSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'migrapilot.sidebar';
  private view?: vscode.WebviewView;
  private attachment?: vscode.Disposable;

  constructor(private readonly shell: MigraPilotShell) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.attachment?.dispose();
    this.attachment = this.shell.attach(webviewView.webview, { compact: true });
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
