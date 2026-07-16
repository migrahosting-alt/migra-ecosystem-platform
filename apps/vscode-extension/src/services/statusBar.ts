import * as vscode from 'vscode';
import type { HealthResponse } from '@migrapilot/shared-types';
import { type ResolvedBackend } from './backendRouter.js';
import { BrainClient } from './brainClient.js';

export class MigraPilotStatusBar {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'migrapilot.health';
    this.item.show();
  }

  get disposable(): vscode.Disposable {
    return this.item;
  }

  async refresh(brainClient: BrainClient): Promise<void> {
    try {
      const health = await brainClient.health();
      this.applyHealth(health);
    } catch {
      this.item.text = '$(warning) MigraPilot: offline';
      this.item.tooltip = 'MigraPilot brain is unreachable';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    }
  }

  applyHealth(health: HealthResponse): void {
    this.item.text = `$(sparkle) MigraPilot: ${health.status}`;
    this.item.tooltip = `MigraPilot brain ${health.status} · v${health.version}`;
    this.item.backgroundColor = undefined;
  }

  /** Reflect the local brain lifecycle outcome as a first-class state: a
   * conflict/unable/disabled result while in local mode is degraded, not an
   * error. 'already-brain'/'started' leave the healthy local state in place. */
  showLocalLifecycle(result: 'already-brain' | 'started' | 'conflict' | 'unable' | 'disabled'): void {
    if (result === 'already-brain' || result === 'started') {
      this.item.text = '$(server) MigraPilot: local';
      this.item.tooltip = 'MigraPilot backend: local brain-service (running)';
      this.item.backgroundColor = undefined;
      return;
    }
    this.item.text = '$(warning) MigraPilot: local (degraded)';
    this.item.tooltip =
      result === 'conflict'
        ? 'Local brain port is held by another service. Run "MigraPilot: Repair Connection".'
        : 'Local brain is not running. Configure migrapilot.brainAutoStartCommand or start it manually.';
    this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  }

  /** Render the resolved backend so the active choice is always visible. */
  showBackend(resolved: ResolvedBackend | undefined): void {
    if (resolved?.kind === 'remote') {
      this.item.text = '$(sparkle) MigraPilot: pilot-api';
      this.item.tooltip = `MigraPilot backend: pilot-api (protocol ${resolved.caps.protocolVersion})`;
      this.item.backgroundColor = undefined;
    } else if (resolved?.kind === 'remote-unavailable') {
      this.item.text = '$(warning) MigraPilot: pilot-api unavailable';
      this.item.tooltip = `pilot-api unavailable: ${resolved.error.code}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = '$(server) MigraPilot: local';
      this.item.tooltip = 'MigraPilot backend: local brain-service';
      this.item.backgroundColor = undefined;
    }
  }
}