import * as vscode from 'vscode';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import type {
  DiagnosticsGetResponse,
  FileReadRangeResponse,
  FileReadSymbolResponse,
} from '@migrapilot/protocol';
import { MigraAiClient } from '../services/migraAiClient.js';
import { BackendRouter } from '../services/backendRouter.js';
import { CAP_EXPLAIN_SELECTION } from '../services/commandCapabilities.js';
import { type CommandDeps, routeCommand, surfacePilotError, withCancellableProgress } from './commandRouting.js';

export async function runExplainSelection(deps: CommandDeps): Promise<void> {
  const brainClient = deps.brainClient;
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('No active editor found.');
    return;
  }

  const selection = editor.document.getText(editor.selection).trim();
  if (!selection) {
    await vscode.window.showWarningMessage('Select some code first.');
    return;
  }

  // Capability gate BEFORE any remote request.
  const { requestId, decision } = await routeCommand(deps.router, CAP_EXPLAIN_SELECTION);
  if (decision.mode === 'denied') {
    await surfacePilotError(deps.output, decision.error, requestId);
    return;
  }
  if (decision.mode === 'remote') {
    await runExplainRemote(deps.router, editor, selection, requestId, deps.output);
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    await vscode.window.showWarningMessage('Open a workspace folder to explain code with repo context.');
    return;
  }

  // All tool execution flows through the MigraAI Engine (never direct /tools/*).
  const diagnosticsResult = await deps.migraAi.runReadOnlyTool<DiagnosticsGetResponse>('diagnostics.get', {
    rootPath: workspaceRoot,
    path: vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/'),
  });

  const selectedRange = getSelectedLineRange(editor);
  const relativePath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
  const fileRangeResult = await deps.migraAi.runReadOnlyTool<FileReadRangeResponse>('file.readRange', {
    rootPath: workspaceRoot,
    path: relativePath,
    startLine: selectedRange.startLine,
    endLine: selectedRange.endLine,
  });
  const symbolResult = await tryReadEnclosingSymbol(
    deps.migraAi,
    workspaceRoot,
    relativePath,
    selectedRange.startLine,
  );

  const route = await brainClient.route({
    feature: 'explain',
    userPrompt: 'Explain this selected code clearly and identify any risks.',
    signals: {
      hasSelection: true,
      hasDiagnostics: diagnosticsResult.items.length > 0,
      openFileCount: vscode.workspace.textDocuments.length,
    },
  });

  const retrieved = await brainClient.retrieve({
    query: selection,
    workspaceRoot,
    feature: 'explain',
    activeFile: editor.document.uri.fsPath,
    selectionText: selection,
    maxChunks: 6,
  });

  const payload: ChatTurnRequest = {
    feature: 'explain',
    modelProfile: route.modelProfile === 'premium' ? 'default' : route.modelProfile === 'none' ? 'cheap' : route.modelProfile,
    systemPromptId: 'explain-selection-v1',
    userPrompt: 'Explain this selected code clearly and identify any risks.',
    context: {
      activeFile: editor.document.uri.fsPath,
      selectionText: buildExplainContext(selection, selectedRange, fileRangeResult, symbolResult),
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
    },
    outputMode: 'markdown',
  };

  const response = await brainClient.chat(payload);
  await showMarkdownResult('MigraPilot: Explain Selection', response.content);
}

async function showMarkdownResult(title: string, content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: `# ${title}\n\n${content}`,
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

/** Remote explain: stream from pilot-api and present ONLY a completed result.
 * Partial output after cancellation/failure is discarded, never shown. */
async function runExplainRemote(
  router: BackendRouter,
  editor: vscode.TextEditor,
  selection: string,
  requestId: string,
  output?: vscode.OutputChannel,
): Promise<void> {
  const remote = {
    message: 'Explain this selected code clearly and identify any risks.',
    requestId,
    context: {
      activeFile: editor.document.uri.fsPath,
      selectionText: selection,
    },
  };
  let content = '';
  let completed = false;
  try {
    await withCancellableProgress('MigraPilot: Explaining selection…', async (signal) => {
      for await (const chunk of router.chat({ requestId, local: null, remote }, signal)) {
        if (chunk.type === 'token') {
          content += chunk.text;
        } else if (chunk.type === 'done') {
          completed = true;
        }
      }
    });
  } catch (err) {
    await surfacePilotError(output, err, requestId);
    return;
  }
  if (!completed) {
    return; // cancelled or truncated — do not present a partial result as complete
  }
  await showMarkdownResult('MigraPilot: Explain Selection (pilot-api)', content);
}

function buildExplainContext(
  selection: string,
  selectedRange: { startLine: number; endLine: number },
  fileRangeResult: FileReadRangeResponse,
  symbolResult: FileReadSymbolResponse | null,
): string {
  const sections = [
    selection,
    '',
    `Selected lines ${selectedRange.startLine}-${selectedRange.endLine}:`,
    fileRangeResult.content,
  ];

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

function getSelectedLineRange(editor: vscode.TextEditor): { startLine: number; endLine: number } {
  const startLine = editor.selection.start.line + 1;
  const endLine = Math.max(startLine, editor.selection.end.line + 1);
  return { startLine, endLine };
}