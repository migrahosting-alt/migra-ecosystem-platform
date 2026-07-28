/**
 * MigraPilot — Diagnose Failure: the first governed workflow wired to a real surface.
 *
 * Deliberately distinct from Fix Diagnostics, which proposes and applies edits. This one
 * only explains: it gathers the failure evidence, asks for a diagnosis, and renders the
 * answer. Nothing it produces can be applied from here.
 *
 * That separation is what makes it the right first proof of the authority chain. The
 * capability class is `repository-diagnosis`, which the benchmark measured as ADVISORY on
 * the deep local model — so the turn runs, keeps its read tools, and has its mutation tools
 * withheld at the Brain. A denied class would prove refusal but not that the read path
 * survives; a mutating class would put an approval prompt in the way of the thing being
 * tested.
 *
 * The class comes from THIS command being invoked. Typing the same words into chat is
 * ordinary assistance and stays ungoverned — the host, not the wording, decides.
 */

import * as vscode from 'vscode';
import { runEngineerTurn } from '../chat/engineerTurn.js';
import type { CommandDeps } from './commandRouting.js';
import { GOVERNED_WORKFLOWS } from '../capability/workflowClassification.js';
import { DIAGNOSE_WORKFLOW, buildDiagnosisPrompt, collectFailureEvidence } from './diagnoseFailureModel.js';
export { DIAGNOSE_WORKFLOW, buildDiagnosisPrompt, collectFailureEvidence } from './diagnoseFailureModel.js';

export async function runDiagnoseFailure(deps: CommandDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('Open the file you want diagnosed.');
    return;
  }
  const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
  if (!diagnostics.some((d) => (d.severity ?? 0) <= 1)) {
    await vscode.window.showInformationMessage('No errors or warnings in the active file.');
    return;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    await vscode.window.showWarningMessage('Open a workspace folder to diagnose with repository context.');
    return;
  }

  const evidence = collectFailureEvidence(editor.document, diagnostics);
  const document = await vscode.workspace.openTextDocument({ language: 'markdown', content: '' });
  await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });

  let buffer = '';
  const append = async (text: string): Promise<void> => {
    buffer += text;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), buffer);
    await vscode.workspace.applyEdit(edit);
  };

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'MigraPilot — diagnosing failure', cancellable: true },
    async (_progress, token) => {
      try {
        // Cancellation is bridged: the command surface speaks VS Code tokens and the turn
        // speaks AbortSignal, and dropping the link would leave a cancelled diagnosis still
        // running against the Brain.
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        await runEngineerTurn(
          deps.migraAi,
          {
            rootPath: root,
            task: buildDiagnosisPrompt(evidence),
            // The class and its provenance come from THIS command being invoked, never from
            // the prompt text above — which deliberately contains the word "diagnose".
            taskClass: GOVERNED_WORKFLOWS[DIAGNOSE_WORKFLOW],
            workflow: DIAGNOSE_WORKFLOW,
          },
          { markdown: (t) => void append(t), progress: () => {} },
          controller.signal,
        );
      } catch (error) {
        deps.output?.appendLine(`[diagnose] failed: ${String(error)}`);
        await append(`\n\n_Diagnosis failed: ${String(error)}_\n`);
      }
    },
  );
}
