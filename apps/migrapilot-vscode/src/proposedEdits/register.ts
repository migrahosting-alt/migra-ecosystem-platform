/**
 * Wires the proposed-edit review/apply/rollback experience into the extension:
 * a native-diff content provider + the review commands. All mutation flows
 * through the controller → applyEngine (WorkspaceEdit); this module is only glue.
 */
import * as vscode from "vscode";
import { ProposedEditClient } from "./client";
import { ProposedEditController, type ProposalUiSink } from "./controller";
import { workspaceIdentity } from "./editSafety";
import type { EditProposal } from "./types";

const PROPOSED_SCHEME = "migrapilot-proposed";

export interface ProposedEditsHandle {
  controller: ProposedEditController;
  workspaceId: string;
  /** Present a native side-by-side diff of a file in a proposal. */
  openDiff(proposal: EditProposal, filePath: string): Promise<void>;
}

export function registerProposedEdits(context: vscode.ExtensionContext, sink: ProposalUiSink = {}): ProposedEditsHandle {
  const client = new ProposedEditClient();
  const controller = new ProposedEditController(client, sink);
  const root = vscode.workspace.workspaceFolders?.[0];
  const workspaceId = workspaceIdentity(vscode.workspace.name, root?.uri.fsPath);

  // Virtual documents holding proposed content, so VS Code's native diff editor
  // can render before/after without touching disk.
  const proposedDocs = new Map<string, string>();
  const provider: vscode.TextDocumentContentProvider = {
    provideTextDocumentContent(uri) { return proposedDocs.get(uri.toString()) ?? ""; },
  };
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(PROPOSED_SCHEME, provider));

  async function openDiff(proposal: EditProposal, filePath: string): Promise<void> {
    const f = proposal.files.find((x) => x.path === filePath);
    if (!f || !root) return;
    if (f.sensitive || f.proposedContent == null) {
      vscode.window.showWarningMessage(`MigraPilot: ${filePath} is a protected/secret file — its proposed content is withheld and cannot be applied.`);
      return;
    }
    const proposedUri = vscode.Uri.parse(`${PROPOSED_SCHEME}:/${proposal.id}/${filePath}?after`);
    proposedDocs.set(proposedUri.toString(), f.proposedContent);
    const currentUri = f.operation === "create"
      ? vscode.Uri.parse(`${PROPOSED_SCHEME}:/${proposal.id}/${filePath}?empty`) // no current file
      : vscode.Uri.joinPath(root.uri, filePath);
    if (f.operation === "create") proposedDocs.set(currentUri.toString(), "");
    const badge = f.operation.toUpperCase();
    await vscode.commands.executeCommand("vscode.diff", currentUri, proposedUri, `MigraPilot ${badge}: ${filePath}`);
  }

  const handle: ProposedEditsHandle = { controller, workspaceId, openDiff };

  context.subscriptions.push(
    vscode.commands.registerCommand("migrapilot.reviewProposedEdit", async (id: string, filePath?: string) => {
      const p = await controller.review(id);
      if (p && filePath) await openDiff(p, filePath);
      else if (p && p.files[0]) await openDiff(p, p.files[0].path);
    }),
    vscode.commands.registerCommand("migrapilot.approveProposedEdit", (id: string) => controller.approve(id, workspaceId)),
    vscode.commands.registerCommand("migrapilot.rejectProposedEdit", (id: string, reason?: string) => controller.reject(id, reason)),
    vscode.commands.registerCommand("migrapilot.applyProposedEdit", async (id: string) => {
      const r = await controller.apply(id, workspaceId);
      if (!r.ok) vscode.window.showWarningMessage(`MigraPilot: apply blocked — ${(r.reasons ?? []).join(", ")}`);
      else vscode.window.showInformationMessage(`MigraPilot: applied (${r.status}). Rollback is available.`);
      return r;
    }),
    vscode.commands.registerCommand("migrapilot.rollbackProposedEdit", async (id: string) => {
      const r = await controller.rollback(id);
      if (!r.ok) vscode.window.showWarningMessage(`MigraPilot: rollback blocked — ${(r.reasons ?? []).join(", ")}`);
      else vscode.window.showInformationMessage("MigraPilot: changes rolled back.");
      return r;
    }),
  );

  return handle;
}
