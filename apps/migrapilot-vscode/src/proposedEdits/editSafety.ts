/**
 * Pure edit-safety helpers (extension side). No file writes here — only hashing,
 * classification, workspace identity, and the strict tool-result → proposal
 * conversion that walls plain model text off from anything applicable.
 */
import * as crypto from "crypto";
import { isSecretLikePath } from "../contextCollector";
import type {
  EditOperation, RiskClass, ProposedEditToolResult, EditProposal, ProposalFile,
} from "./types";

export { isSecretLikePath };

export function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

const OPERATIONS: EditOperation[] = ["create", "modify", "delete", "rename"];

export function classifyRisk(op: EditOperation, sensitive: boolean): RiskClass {
  if (sensitive) return "HIGH";
  if (op === "delete" || op === "rename") return "HIGH";
  if (op === "modify") return "MEDIUM";
  return "LOW";
}
export function maxRisk(a: RiskClass, b: RiskClass): RiskClass {
  const rank: Record<RiskClass, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * A stable-ish workspace identity string. Binds a proposal to the folder it was
 * generated against so approvals cannot cross workspaces (mission §17, §5).
 */
export function workspaceIdentity(name: string | undefined, rootFsPath: string | undefined): string {
  const basis = `${name ?? "unknown"}::${rootFsPath ?? "no-root"}`;
  return `ws:${sha256(basis).slice(0, 24)}`;
}

/** Reject absolute / traversal / home / null-byte paths; return normalized POSIX. */
export function isSafeRelPath(p: string): boolean {
  if (typeof p !== "string" || p.trim() === "") return false;
  const s = p.trim();
  if (s.includes("\0")) return false;
  if (s.startsWith("~") || s.startsWith("/") || s.startsWith("\\")) return false;
  if (/^[A-Za-z]:[\\/]/.test(s)) return false;
  const segs = s.replace(/\\/g, "/").split("/");
  return !segs.includes("..");
}

export class ToolResultError extends Error {}

/**
 * Strict conversion of a tool result into a proposal payload (mission §2, §26).
 * ONLY a well-formed `{ kind: "proposed_edit", files: [...] }` object passes.
 * Plain strings, null, arrays, or shapeless objects are rejected — this is the
 * wall between free-form model output and any applicable edit.
 */
export function proposalFromToolResult(
  raw: unknown,
  ctx: { workspaceId: string; conversationId?: string | null; missionId?: string | null; taskId?: string | null },
): {
  workspaceId: string; conversationId?: string | null; missionId?: string | null; taskId?: string | null;
  title: string; explanation: string; provider?: unknown;
  files: Array<{ path: string; operation: EditOperation; renameTo?: string; originalHash?: string; proposedContent?: string }>;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ToolResultError("not a proposed_edit tool result (plain text cannot become a proposal)");
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== "proposed_edit") throw new ToolResultError("tool result kind must be 'proposed_edit'");
  if (typeof o.title !== "string" || typeof o.explanation !== "string") throw new ToolResultError("title and explanation are required");
  if (!Array.isArray(o.files) || o.files.length === 0) throw new ToolResultError("files must be a non-empty array");

  const files = o.files.map((f, i) => {
    if (f === null || typeof f !== "object") throw new ToolResultError(`files[${i}] must be an object`);
    const ff = f as Record<string, unknown>;
    if (typeof ff.path !== "string" || !isSafeRelPath(ff.path)) throw new ToolResultError(`files[${i}].path is not a safe workspace-relative path`);
    if (typeof ff.operation !== "string" || !OPERATIONS.includes(ff.operation as EditOperation)) throw new ToolResultError(`files[${i}].operation invalid`);
    const op = ff.operation as EditOperation;
    const out: { path: string; operation: EditOperation; renameTo?: string; originalHash?: string; proposedContent?: string } = { path: ff.path, operation: op };
    if (typeof ff.renameTo === "string") out.renameTo = ff.renameTo;
    if (typeof ff.originalContent === "string") out.originalHash = sha256(ff.originalContent);
    if (typeof ff.originalHash === "string") out.originalHash = ff.originalHash;
    if (typeof ff.proposedContent === "string") out.proposedContent = ff.proposedContent;
    return out;
  });

  return {
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversationId ?? null,
    missionId: ctx.missionId ?? null,
    taskId: ctx.taskId ?? null,
    title: o.title,
    explanation: o.explanation,
    provider: o.provider ?? null,
    files,
  };
}

/** Locally re-derive file metadata (sensitive/risk) for a proposal DTO from the backend. */
export function annotateProposalFile(f: ProposalFile): ProposalFile {
  const sensitive = f.sensitive || isSecretLikePath(f.path) || (f.renameTo ? isSecretLikePath(f.renameTo) : false);
  return { ...f, sensitive, riskClass: classifyRisk(f.operation, sensitive) };
}

/** True when abs is the same as root or nested strictly inside it. */
export function isInsideWorkspace(rootFsPath: string, absFsPath: string): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const r = norm(rootFsPath);
  const a = norm(absFsPath);
  return a === r || a.startsWith(r + "/");
}

export function proposalOverallRisk(p: Pick<EditProposal, "files">): RiskClass {
  return p.files.reduce<RiskClass>((acc, f) => maxRisk(acc, classifyRisk(f.operation, f.sensitive)), "LOW");
}
