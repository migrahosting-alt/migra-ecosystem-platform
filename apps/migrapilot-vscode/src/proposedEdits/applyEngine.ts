/**
 * Proposed-edit apply + rollback engine (extension side).
 *
 * All file mutation happens HERE, through vscode.WorkspaceEdit only — never a
 * shell, never git. Every apply is preceded by a fail-closed preflight
 * (workspace trust, containment, symlink, dirty, existence, hash staleness).
 * Rollback verifies files are unchanged since apply before restoring, so newer
 * user work is never silently overwritten (mission §5, §7, §8).
 */
import * as vscode from "vscode";
import { sha256, isInsideWorkspace } from "./editSafety";
import type {
  EditProposal, ProposalFile, FileLiveState, RollbackLiveState,
  ApplyOutcome, ApplyFileResult, RollbackPlanItem, RollbackOutcome,
} from "./types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function workspaceRoot(): vscode.WorkspaceFolder | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length > 0 ? folders[0] : undefined;
}

function uriFor(root: vscode.WorkspaceFolder, relPath: string): vscode.Uri {
  return vscode.Uri.joinPath(root.uri, relPath);
}

async function statOrNull(uri: vscode.Uri): Promise<vscode.FileStat | null> {
  try { return await vscode.workspace.fs.stat(uri); } catch { return null; }
}
async function readText(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return dec.decode(bytes);
}
function isSymlink(stat: vscode.FileStat | null): boolean {
  return !!stat && (stat.type & vscode.FileType.SymbolicLink) !== 0;
}
function isDirty(fsPath: string): boolean {
  return (vscode.workspace.textDocuments || []).some((d) => d.uri.fsPath === fsPath && d.isDirty);
}

/** Collect the live on-disk state the backend authorizer needs (mission §3, §5). */
export async function collectLiveState(proposal: EditProposal): Promise<FileLiveState[]> {
  const root = workspaceRoot();
  const out: FileLiveState[] = [];
  for (const f of proposal.files) {
    if (!root) { out.push({ path: f.path, currentHash: null, dirty: false, exists: false }); continue; }
    const uri = uriFor(root, f.path);
    const stat = await statOrNull(uri);
    let currentHash: string | null = null;
    if (stat && !isSymlink(stat)) { try { currentHash = sha256(await readText(uri)); } catch { currentHash = null; } }
    out.push({ path: f.path, currentHash, dirty: isDirty(uri.fsPath), exists: !!stat });
  }
  return out;
}

/** Live state for a rollback staleness check (paths where applied content now lives). */
export async function collectRollbackState(items: RollbackPlanItem[]): Promise<RollbackLiveState[]> {
  const root = workspaceRoot();
  const out: RollbackLiveState[] = [];
  for (const it of items) {
    const targetPath = it.operation === "rename" ? (it.renameTo ?? it.path) : it.path;
    if (!root) { out.push({ path: targetPath, currentHash: null, exists: false }); continue; }
    const uri = uriFor(root, targetPath);
    const stat = await statOrNull(uri);
    let currentHash: string | null = null;
    if (stat && !isSymlink(stat)) { try { currentHash = sha256(await readText(uri)); } catch { currentHash = null; } }
    out.push({ path: targetPath, currentHash, exists: !!stat });
  }
  return out;
}

interface Snapshot { file: ProposalFile; preApplyContent: string | null }

/**
 * Preflight ALL files before any write. Fails closed: returns blocked reasons and
 * performs no mutation if anything is unsafe (mission §5).
 */
async function preflight(proposal: EditProposal): Promise<{ reasons: string[]; snapshots: Snapshot[]; root?: vscode.WorkspaceFolder }> {
  const reasons: string[] = [];
  const snapshots: Snapshot[] = [];

  if (vscode.workspace.isTrusted === false) { reasons.push("workspace_not_trusted"); return { reasons, snapshots }; }
  const root = workspaceRoot();
  if (!root) { reasons.push("no_workspace_folder"); return { reasons, snapshots }; }

  for (const f of proposal.files) {
    // create/modify must carry content; sensitive files are always withheld.
    if (f.sensitive || ((f.operation === "create" || f.operation === "modify") && f.proposedContent == null)) {
      reasons.push(`sensitive_or_withheld:${f.path}`);
      continue;
    }
    const uri = uriFor(root, f.path);
    if (!isInsideWorkspace(root.uri.fsPath, uri.fsPath)) { reasons.push(`escapes_workspace:${f.path}`); continue; }
    if (isDirty(uri.fsPath)) reasons.push(`dirty:${f.path}`);

    const stat = await statOrNull(uri);
    if (isSymlink(stat)) { reasons.push(`symlink:${f.path}`); continue; }

    if (f.operation === "create") {
      if (stat) reasons.push(`already_exists:${f.path}`);
      snapshots.push({ file: f, preApplyContent: null });
    } else {
      if (!stat) { reasons.push(`missing_on_disk:${f.path}`); continue; }
      let cur: string;
      try { cur = await readText(uri); } catch { reasons.push(`unreadable:${f.path}`); continue; }
      if (sha256(cur) !== f.originalHash) reasons.push(`stale:${f.path}`);       // external change / stale hash
      snapshots.push({ file: f, preApplyContent: cur });                          // rollback snapshot
      if (f.operation === "rename") {
        const toUri = uriFor(root, f.renameTo!);
        if (!isInsideWorkspace(root.uri.fsPath, toUri.fsPath)) reasons.push(`rename_escapes_workspace:${f.renameTo}`);
        if (await statOrNull(toUri)) reasons.push(`rename_target_exists:${f.renameTo}`);
      }
    }
  }
  return { reasons, snapshots, root };
}

/** Apply a single file op via its own WorkspaceEdit. Returns true iff applied. */
async function applyOne(root: vscode.WorkspaceFolder, f: ProposalFile): Promise<boolean> {
  const edit = new vscode.WorkspaceEdit();
  const uri = uriFor(root, f.path);
  if (f.operation === "create") {
    edit.createFile(uri, { contents: enc.encode(f.proposedContent ?? ""), ignoreIfExists: false });
  } else if (f.operation === "modify") {
    edit.createFile(uri, { overwrite: true, contents: enc.encode(f.proposedContent ?? "") });
  } else if (f.operation === "delete") {
    edit.deleteFile(uri, { ignoreIfNotExists: false });
  } else { // rename
    edit.renameFile(uri, uriFor(root, f.renameTo!), { overwrite: false });
  }
  return vscode.workspace.applyEdit(edit);
}

/**
 * Apply a proposal through WorkspaceEdit. Preflight-gated and fail-closed. Files
 * apply sequentially so a mid-batch failure yields an EXACT partial state that is
 * reported and stopped — never silently continued (mission §7).
 */
export async function applyProposal(proposal: EditProposal): Promise<ApplyOutcome> {
  const { reasons, snapshots, root } = await preflight(proposal);
  if (reasons.length > 0 || !root) {
    return { ok: false, blocked: true, outcome: "blocked", reasons, results: [] };
  }

  const results: ApplyFileResult[] = [];
  let failed = false;
  for (const snap of snapshots) {
    const f = snap.file;
    if (failed) { results.push({ path: f.path, applyState: "skipped" }); continue; } // stop, do not continue
    try {
      const ok = await applyOne(root, f);
      if (!ok) { results.push({ path: f.path, applyState: "failed", error: "applyEdit returned false" }); failed = true; continue; }
      const postHash =
        f.operation === "delete" ? null
        : f.operation === "rename" ? (snap.preApplyContent != null ? sha256(snap.preApplyContent) : null)
        : sha256(f.proposedContent ?? "");
      results.push({ path: f.path, applyState: "applied", preApplyContent: snap.preApplyContent, postApplyHash: postHash });
    } catch (e: any) {
      results.push({ path: f.path, applyState: "failed", error: e?.message ?? String(e) });
      failed = true;
    }
  }

  const anyApplied = results.some((r) => r.applyState === "applied");
  const allApplied = results.every((r) => r.applyState === "applied");
  const outcome: ApplyOutcome["outcome"] = allApplied ? "applied" : anyApplied ? "partial" : "failed";
  return { ok: allApplied, blocked: false, outcome, reasons: [], results };
}

/**
 * Roll back applied files. Verifies each target is unchanged since apply
 * (currentHash === postApplyHash / expected existence) before restoring, so
 * newer user work is never overwritten (mission §8).
 */
export async function rollbackProposal(items: RollbackPlanItem[]): Promise<RollbackOutcome> {
  const root = workspaceRoot();
  if (!root) return { ok: false, blocked: true, reasons: ["no_workspace_folder"], results: [] };

  // staleness preflight — block if anything changed since apply
  const reasons: string[] = [];
  const live = await collectRollbackState(items);
  const liveByPath = new Map(live.map((l) => [l.path, l]));
  for (const it of items) {
    const target = it.operation === "rename" ? (it.renameTo ?? it.path) : it.path;
    const l = liveByPath.get(target);
    if (it.operation === "delete") {
      if (l?.exists) reasons.push(`recreated_since_apply:${it.path}`);
    } else if (it.operation === "create") {
      if (!l?.exists || l.currentHash !== it.postApplyHash) reasons.push(`changed_since_apply:${it.path}`);
    } else { // modify / rename
      if (!l?.exists || l.currentHash !== it.postApplyHash) reasons.push(`changed_since_apply:${target}`);
    }
  }
  if (reasons.length > 0) return { ok: false, blocked: true, reasons, results: [] };

  const results: RollbackOutcome["results"] = [];
  for (const it of items) {
    try {
      const edit = new vscode.WorkspaceEdit();
      if (it.operation === "create") {
        edit.deleteFile(uriFor(root, it.path), { ignoreIfNotExists: true });          // remove only the created file
        await vscode.workspace.applyEdit(edit); results.push({ path: it.path, state: "removed" });
      } else if (it.operation === "delete") {
        edit.createFile(uriFor(root, it.path), { contents: enc.encode(it.preApplyContent ?? ""), overwrite: true });
        await vscode.workspace.applyEdit(edit); results.push({ path: it.path, state: "restored" });
      } else if (it.operation === "rename") {
        edit.renameFile(uriFor(root, it.renameTo!), uriFor(root, it.path), { overwrite: false });
        await vscode.workspace.applyEdit(edit);
        if (it.preApplyContent != null) {
          const e2 = new vscode.WorkspaceEdit();
          e2.createFile(uriFor(root, it.path), { overwrite: true, contents: enc.encode(it.preApplyContent) });
          await vscode.workspace.applyEdit(e2);
        }
        results.push({ path: it.path, state: "restored" });
      } else { // modify
        edit.createFile(uriFor(root, it.path), { overwrite: true, contents: enc.encode(it.preApplyContent ?? "") });
        await vscode.workspace.applyEdit(edit); results.push({ path: it.path, state: "restored" });
      }
    } catch (e: any) {
      results.push({ path: it.path, state: "failed" });
    }
  }
  const ok = results.every((r) => r.state !== "failed");
  return { ok, blocked: false, reasons: [], results };
}
