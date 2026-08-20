import * as vscode from 'vscode';
import type { HealthResponse } from '@migrapilot/shared-types';
import { type ResolvedBackend } from './backendRouter.js';
import { BrainClient } from './brainClient.js';
import {
  statusBarFor,
  type OutcomePresentation,
} from './brainOutcomePresentation.js';

/** Read live: the setting can change without a reload. */
function developerMode(): boolean {
  return vscode.workspace.getConfiguration('migrapilot').get<boolean>('developerMode', false) === true;
}

/**
 * The one MigraPilot item in VS Code's own status bar.
 *
 * A user needs one thing from it: is MigraPilot ready. It used to read
 * "MigraPilot: local" / "MigraPilot: pilot-api" — backend topology on the strip a
 * person glances at while coding — and clicking it opened a diagnostics dialog.
 * In product mode it states readiness and opens MigraPilot; developer mode keeps
 * the topology and the health dialog.
 */
export class MigraPilotStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = developerMode() ? 'migrapilot.health' : 'migrapilot.openStudio';
    this.item.show();
  }

  /** Backend topology is engineering; readiness is product. */
  private topology(engineering: string, ready: string): string {
    return developerMode() ? engineering : ready;
  }

  get disposable(): vscode.Disposable {
    return this.item;
  }

  async refresh(brainClient: BrainClient): Promise<void> {
    try {
      const health = await brainClient.health();
      this.applyHealth(health);
    } catch {
      this.item.text = '$(warning) MigraPilot: not ready';
      this.item.tooltip = developerMode() ? 'MigraPilot brain is unreachable' : 'MigraPilot is not running.';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  /**
   * Render a governed operation outcome. The wording, icon and colour all come from
   * the shared presenter, so the status bar cannot say "done" while the persisted
   * record says the terminal revision was never written.
   */
  showOperationOutcome(p: OutcomePresentation): void {
    const v = statusBarFor(p);
    this.item.text = v.text;
    this.item.tooltip = v.tooltip;
    this.item.backgroundColor = v.error
      ? new vscode.ThemeColor('statusBarItem.errorBackground')
      : v.warning
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : undefined;
  }

  applyHealth(health: HealthResponse): void {
    this.item.text = this.topology(`$(sparkle) MigraPilot: ${health.status}`,
      health.status === 'ok' ? '$(sparkle) MigraPilot: ready' : '$(warning) MigraPilot: limited');
    this.item.tooltip = developerMode()
      ? `MigraPilot brain ${health.status} · v${health.version}`
      : health.status === 'ok' ? 'MigraPilot is ready.' : 'MigraPilot is running with reduced capability.';
    this.item.backgroundColor = undefined;
  }

  /** Reflect the local brain lifecycle outcome as a first-class state: a
   * conflict/unable/disabled result while in local mode is degraded, not an
   * error. 'already-brain'/'started' leave the healthy local state in place. */
  showLocalLifecycle(result: 'already-brain' | 'started' | 'conflict' | 'unable' | 'disabled'): void {
    if (result === 'already-brain' || result === 'started') {
      this.item.text = this.topology('$(server) MigraPilot: local', '$(sparkle) MigraPilot: ready');
      this.item.tooltip = developerMode() ? 'MigraPilot backend: local brain-service (running)' : 'MigraPilot is ready.';
      this.item.backgroundColor = undefined;
      return;
    }
    this.item.text = this.topology('$(warning) MigraPilot: local (degraded)', '$(warning) MigraPilot: not ready');
    this.item.tooltip = developerMode()
      ? result === 'conflict'
        ? 'Local brain port is held by another service. Run "MigraPilot: Repair Connection".'
        : 'Local brain is not running. Configure migrapilot.brainAutoStartCommand or start it manually.'
      : 'MigraPilot is not running. Reload the window to start it again.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /** Render the resolved backend so the active choice is always visible. */
  showBackend(resolved: ResolvedBackend | undefined): void {
    if (resolved?.kind === 'remote') {
      this.item.text = this.topology('$(sparkle) MigraPilot: pilot-api', '$(sparkle) MigraPilot: ready');
      this.item.tooltip = developerMode()
        ? `MigraPilot backend: pilot-api (protocol ${resolved.caps.protocolVersion})`
        : 'MigraPilot is ready.';
      this.item.backgroundColor = undefined;
    } else if (resolved?.kind === 'remote-unavailable') {
      this.item.text = this.topology('$(warning) MigraPilot: pilot-api unavailable', '$(warning) MigraPilot: not ready');
      // The engine's error CODE is diagnostics; a user is told the state, not the code.
      this.item.tooltip = developerMode() ? `pilot-api unavailable: ${resolved.error.code}` : 'MigraPilot cannot run right now.';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = this.topology('$(server) MigraPilot: local', '$(sparkle) MigraPilot: ready');
      this.item.tooltip = developerMode() ? 'MigraPilot backend: local brain-service' : 'MigraPilot is ready.';
      this.item.backgroundColor = undefined;
    }
  }
}