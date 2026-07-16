import * as vscode from 'vscode';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import type {
  DiagnosticsGetResponse,
  FileReadRangeResponse,
  GitDiffResponse,
  FileReadSymbolResponse,
} from '@migrapilot/protocol';
import type { ProposedEdit } from '@migrapilot/shared-types';
import { MigraAiClient } from '../services/migraAiClient.js';
import { previewAndMaybeApplyProposedEdits } from '../services/proposedEdits.js';
import { CAP_FIX_DIAGNOSTICS } from '../services/commandCapabilities.js';
import { type CommandDeps, routeCommand, surfacePilotError, withCancellableProgress } from './commandRouting.js';

export async function runFixDiagnostics(deps: CommandDeps): Promise<void> {
  const brainClient = deps.brainClient;
  const editor = vscode.window.activeTextEditor;
  const uri = editor?.document.uri;

  if (!editor || !uri) {
    await vscode.window.showWarningMessage('No active file to diagnose.');
    return;
  }

  const diagnostics = vscode.languages.getDiagnostics(uri);
  if (!diagnostics.length) {
    await vscode.window.showInformationMessage('No diagnostics found in the active file.');
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    await vscode.window.showWarningMessage('Open a workspace folder to fix diagnostics with repo context.');
    return;
  }

  // Capability gate BEFORE any remote request or workspace mutation.
  const { requestId, decision } = await routeCommand(deps.router, CAP_FIX_DIAGNOSTICS);
  if (decision.mode === 'denied') {
    await surfacePilotError(deps.output, decision.error, requestId);
    return;
  }
  if (decision.mode === 'remote') {
    await runFixRemote(deps, editor, uri, workspaceRoot, requestId);
    return;
  }

  const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');

  // All tool execution flows through the MigraAI Engine (never direct /tools/*).
  const diagnosticsResult = await deps.migraAi.runReadOnlyTool<DiagnosticsGetResponse>('diagnostics.get', {
    rootPath: workspaceRoot,
    path: relativePath,
  });

  const primaryDiagnostic = diagnosticsResult.items[0] ?? null;
  const focusRange = getDiagnosticFocusRange(diagnosticsResult.items);
  const symbolResult = primaryDiagnostic
    ? await tryReadEnclosingSymbol(
        deps.migraAi,
        workspaceRoot,
        relativePath,
        primaryDiagnostic.range.startLine,
      )
    : null;
  const fileRangeResult = await deps.migraAi.runReadOnlyTool<FileReadRangeResponse>('file.readRange', {
    rootPath: workspaceRoot,
    path: relativePath,
    startLine: focusRange.startLine,
    endLine: focusRange.endLine,
  });

  const diffResult = await deps.migraAi.runReadOnlyTool<GitDiffResponse>('git.diff', {
    rootPath: workspaceRoot,
    path: relativePath,
  });

  const route = await brainClient.route({
    feature: 'fix',
    userPrompt: 'Analyze the active diagnostics and propose a targeted fix.',
    signals: {
      hasDiagnostics: true,
      hasSelection: !editor.selection.isEmpty,
      openFileCount: vscode.workspace.textDocuments.length,
    },
  });

  const retrieved = await brainClient.retrieve({
    query: diagnosticsResult.items.map((item) => item.message).join('\n'),
    workspaceRoot,
    feature: 'fix',
    activeFile: uri.fsPath,
    selectionText: editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection),
    maxChunks: 8,
  });

  const payload: ChatTurnRequest = {
    feature: 'fix',
    modelProfile: route.modelProfile === 'premium' ? 'default' : route.modelProfile === 'none' ? 'cheap' : route.modelProfile,
    systemPromptId: 'fix-diagnostics-v1',
    userPrompt: 'Analyze the diagnostics and propose the smallest safe fix first.',
    context: {
      activeFile: uri.fsPath,
      selectionText: buildFixContext(editor, focusRange, fileRangeResult, symbolResult),
      diagnostics: diagnosticsResult.items.map((item) => ({
        file: item.path,
        code: item.code ?? undefined,
        message: item.message,
        severity: item.severity === 'information' || item.severity === 'hint' ? 'info' : item.severity,
        startLine: item.range.startLine,
        endLine: item.range.endLine,
      })),
      retrievedChunks: [
        ...(symbolResult
          ? [{
              path: symbolResult.path,
              startLine: symbolResult.range.startLine,
              endLine: symbolResult.range.endLine,
              snippet: symbolResult.content,
              score: 1,
              source: 'symbol' as const,
            }]
          : []),
        {
          path: fileRangeResult.path,
          startLine: fileRangeResult.startLine,
          endLine: fileRangeResult.endLine,
          snippet: fileRangeResult.content,
          score: 1,
          source: 'recent',
        },
        ...retrieved.chunks,
      ],
      gitDiff: diffResult.diff,
    },
    outputMode: 'structured_fix',
  };

  const response = await brainClient.chat(payload);

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# MigraPilot Fix Diagnostics\n\n${response.content}`,
  });
  await vscode.window.showTextDocument(document, { preview: true });

  if (response.proposedEdits?.length) {
    await previewAndMaybeApplyProposedEdits(
      deps.migraAi,
      workspaceRoot,
      response.proposedEdits,
      'MigraPilot Fix Preview',
    );
  }
}

function buildFixContext(
  editor: vscode.TextEditor,
  focusRange: { startLine: number; endLine: number },
  fileRangeResult: FileReadRangeResponse,
  symbolResult: FileReadSymbolResponse | null,
): string {
  const sections: string[] = [];

  if (!editor.selection.isEmpty) {
    sections.push(editor.document.getText(editor.selection), '');
  }

  sections.push(
    `Focus lines ${focusRange.startLine}-${focusRange.endLine}:`,
    fileRangeResult.content,
  );

  if (symbolResult) {
    sections.push(
      '',
      `Enclosing ${symbolResult.kind} ${symbolResult.symbolName} lines ${symbolResult.range.startLine}-${symbolResult.range.endLine}:`,
      symbolResult.content,
    );
  }

  return sections.join('\n');
}

async function tryReadEnclosingSymbol(
  migraAi: MigraAiClient,
  workspaceRoot: string,
  relativePath: string,
  line: number,
): Promise<FileReadSymbolResponse | null> {
  try {
    return await migraAi.runReadOnlyTool<FileReadSymbolResponse>('file.readSymbol', {
      rootPath: workspaceRoot,
      path: relativePath,
      line,
    });
  } catch {
    return null;
  }
}

function getDiagnosticFocusRange(
  diagnostics: readonly { range: { startLine: number; endLine: number } }[],
): { startLine: number; endLine: number } {
  const first = diagnostics[0];
  if (!first) {
    return { startLine: 1, endLine: 20 };
  }
  return {
    startLine: Math.max(1, first.range.startLine - 3),
    endLine: Math.max(first.range.endLine, first.range.startLine + 3),
  };
}

/** Remote fix: fetch proposed edits from pilot-api, then run them through the
 * SAME approval/apply boundary (non-mutating until authorized, with read-back
 * verification). Correlation ids are preserved in the run log. */
async function runFixRemote(
  deps: CommandDeps,
  editor: vscode.TextEditor,
  uri: vscode.Uri,
  workspaceRoot: string,
  requestId: string,
): Promise<void> {
  void editor;
  const relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  const diagnostics = vscode.languages.getDiagnostics(uri).map((item) => ({
    file: relativePath,
    message: item.message,
    severity:
      item.severity === vscode.DiagnosticSeverity.Error
        ? 'error'
        : item.severity === vscode.DiagnosticSeverity.Warning
          ? 'warning'
          : 'info',
    startLine: item.range.start.line + 1,
    endLine: item.range.end.line + 1,
  }));

  let res: { runId?: string; actionId?: string; proposedEdits?: ProposedEdit[] };
  try {
    res = await withCancellableProgress('MigraPilot: Requesting fix from pilot-api…', (signal) =>
      deps.pilot.request('POST', '/api/pilot/proposed-edits', {
        body: { requestId, path: relativePath, diagnostics },
        signal,
        requestId,
      }),
    );
  } catch (err) {
    await surfacePilotError(deps.output, err, requestId);
    return;
  }

  // Preserve correlation ids in the run log — never the JWT or raw body.
  deps.output?.appendLine(
    `[${new Date().toISOString()}] fix remote [req ${requestId}] runId=${res.runId ?? '-'} actionId=${res.actionId ?? '-'} edits=${res.proposedEdits?.length ?? 0}`,
  );

  if (!res.proposedEdits?.length) {
    await vscode.window.showInformationMessage('pilot-api proposed no edits for the current diagnostics.');
    return;
  }

  await previewAndMaybeApplyProposedEdits(
    deps.migraAi,
    workspaceRoot,
    res.proposedEdits,
    'MigraPilot Fix Preview (pilot-api)',
  );
}
