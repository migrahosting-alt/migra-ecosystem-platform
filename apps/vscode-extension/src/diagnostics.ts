import * as vscode from 'vscode';

import { BrainOperationError, callBrainTool } from './services/brainClient.js';
import type {
  DiagnosticsGetResponse,
  DiagnosticsSyncRequest,
} from '@migrapilot/protocol';
import { type PilotApiClient } from '@migrapilot/pilot-client';

type SyncedDiagnostic = DiagnosticsGetResponse['items'][number];

function toSeverity(severity: vscode.DiagnosticSeverity): SyncedDiagnostic['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'information';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
    default:
      return 'information';
  }
}

function workspaceRootPath(): string | null {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? null;
}

export function collectDiagnostics(): SyncedDiagnostic[] {
  const rootPath = workspaceRootPath();
  if (!rootPath) {
    return [];
  }

  const result: SyncedDiagnostic[] = [];

  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file') {
      continue;
    }

    const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    for (const diagnostic of diagnostics) {
      result.push({
        path: relativePath,
        severity: toSeverity(diagnostic.severity),
        code: diagnostic.code == null ? null : String(typeof diagnostic.code === 'object' ? diagnostic.code.value : diagnostic.code),
        source: diagnostic.source ?? null,
        message: diagnostic.message,
        range: {
          startLine: diagnostic.range.start.line + 1,
          startCharacter: diagnostic.range.start.character + 1,
          endLine: diagnostic.range.end.line + 1,
          endCharacter: diagnostic.range.end.character + 1,
        },
      });
    }
  }

  return result;
}

export async function syncDiagnostics(brainServiceUrl: string): Promise<void> {
  const rootPath = workspaceRootPath();
  if (!rootPath) {
    return;
  }

  const body: DiagnosticsSyncRequest = {
    rootPath,
    items: collectDiagnostics(),
  };

  // Governed: routed through the approved Brain transport so a diagnostics sync gets
  // the same timeout, cancellation and structured failure classification as any other
  // Brain call. A non-terminal outcome throws with the OBSERVED category attached.
  const outcome = await callBrainTool<DiagnosticsSyncRequest, unknown>(
    brainServiceUrl,
    '/internal/diagnostics.sync',
    body,
  );

  if (!outcome.ok) {
    throw new BrainOperationError(
      outcome.record,
      outcome.record.failureCategory,
      `Failed to sync diagnostics: ${outcome.statusLine}`,
    );
  }
}

/** Remote diagnostics sync to pilot-api (used when the resolved backend is
 * remote and supports workspace.read). Throws a PilotError on failure. */
export async function syncDiagnosticsToPilot(pilot: PilotApiClient): Promise<void> {
  const rootPath = workspaceRootPath();
  if (!rootPath) {
    return;
  }
  await pilot.request('POST', '/api/pilot/workspace', {
    body: { rootPath, items: collectDiagnostics() },
  });
}