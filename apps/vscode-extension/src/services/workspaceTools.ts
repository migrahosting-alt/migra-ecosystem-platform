/*
 * THE WORKSPACE TOOLS, RUN WHERE THE WORKSPACE IS.
 *
 * These executed inside the Brain while the Brain ran on the developer's
 * machine. Once it moved to a shared governed server the files were no longer
 * there: reads failed, and a directory listing came back EMPTY — telling the
 * agent the project had no files and inviting it to invent some.
 *
 * So the Brain plans and governs; this client executes. Two rules shape
 * everything below.
 *
 * ONE IMPLEMENTATION, NOT TWO THAT AGREE TODAY. The tree, file and git tools are
 * imported from @migrapilot/workspace-tools — the same functions the Brain runs
 * — rather than rewritten here. A second implementation would pass its own tests
 * and drift on the first edge case nobody thought to mirror. Only tools that are
 * genuinely EDITOR capabilities get a local adapter, and those are better here
 * than in the Brain: real language-server symbols and real diagnostics, not a
 * parser's approximation of them.
 *
 * A PLANNER DOES NOT GET TO WRITE. The two mutating tools are gated on explicit
 * operator approval, taken from the shared registry rather than remembered here,
 * so a remote model cannot reach the working tree on its own say-so. A refusal is
 * returned as a structured RESULT the agent can reason about, not an error that
 * looks like a malfunction.
 */

import {
  workspaceList,
  workspaceFind,
  workspaceSearch,
  fileRead,
  fileReadRange,
  gitStatus,
  gitDiff,
  gitOverview,
  gitHistory,
  gitBlame,
  workspaceToolMeta,
  applyRequiresApproval,
  WORKSPACE_TOOL_IDS,
  WORKSPACE_TOOL_CONTRACT_VERSION,
} from '@migrapilot/workspace-tools';

/** The contract this client speaks. Sent with every run so the Brain can refuse a mismatch. */
export const CLIENT_CONTRACT_VERSION = WORKSPACE_TOOL_CONTRACT_VERSION;

export class WorkspaceToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}

/**
 * Editor capabilities this client provides, injected so the executor stays
 * testable without a running VS Code.
 */
export interface WorkspaceToolHost {
  /** Problems as the EDITOR sees them — every language server, not one parser. */
  diagnostics(rootPath: string, filePath?: string): Promise<unknown>;
  /** Symbols from the language server that owns the file. */
  documentSymbols(rootPath: string, filePath: string): Promise<unknown>;
  /**
   * Ask the operator to approve a mutating change. Returning false is a normal
   * answer, not a failure: the human declined.
   */
  requestApproval(summary: { tool: string; fileCount: number; paths: string[] }): Promise<boolean>;
  /** Apply an approved changeset to the working tree. */
  applyChangeset(input: { rootPath: string; ops: Array<Record<string, unknown>> }): Promise<unknown>;
}

const asRecord = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** vscode.SymbolKind names -> the protocol's `kind` enum. */
const SYMBOL_KIND: Record<string, string> = {
  function: 'function',
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  method: 'method',
  variable: 'variable',
  constant: 'variable',
  property: 'variable',
  field: 'variable',
  constructor: 'method',
  struct: 'class',
  typeparameter: 'type',
  object: 'variable',
};

/** Read an inclusive, 1-based line span from a file inside the root. */
async function readFileRange(root: string, rel: string, startLine: number, endLine: number): Promise<string> {
  const nodeFs = await import('node:fs/promises');
  const nodePath = await import('node:path');
  const abs = nodePath.resolve(root, rel);
  if (abs !== nodePath.resolve(root) && !abs.startsWith(nodePath.resolve(root) + nodePath.sep)) {
    throw new WorkspaceToolError(`"${rel}" is outside the workspace root`);
  }
  const text = await nodeFs.readFile(abs, 'utf8');
  return text.split('\n').slice(Math.max(0, startLine - 1), endLine).join('\n');
}

/**
 * Assert the root exists. The check whose ABSENCE caused the original defect:
 * without it a missing workspace lists as empty, and "empty" is the answer that
 * makes a model start inventing.
 */
async function assertRoot(rootPath: unknown): Promise<string> {
  const root = str(rootPath);
  if (!root) throw new WorkspaceToolError('rootPath is required');
  const { promises: fs } = await import('node:fs');
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new WorkspaceToolError(`workspace root "${root}" does not exist on this machine`);
  }
  if (!stat.isDirectory()) throw new WorkspaceToolError(`workspace root "${root}" is not a directory`);
  return root;
}

/** Ops as the changeset tools describe them, resolved against what is really on disk. */
async function resolveOps(root: string, rawOps: unknown): Promise<{
  ops: Array<Record<string, unknown>>;
  resolved: Array<{ op: string; path: string; exists: boolean; effect: string; bytes: number }>;
  totalBytes: number;
}> {
  const ops = Array.isArray(rawOps) ? (rawOps as Array<Record<string, unknown>>) : [];
  if (!ops.length) throw new WorkspaceToolError('ops must contain at least one operation');
  const { promises: fs } = await import('node:fs');
  const path = await import('node:path');
  const resolved = [];
  let totalBytes = 0;
  for (const op of ops) {
    const rel = str(op.path);
    if (!rel) throw new WorkspaceToolError('every op needs a path');
    const base = path.resolve(root);
    const target = path.resolve(base, rel);
    const withSep = base.endsWith(path.sep) ? base : base + path.sep;
    if (target !== base && !target.startsWith(withSep)) {
      throw new WorkspaceToolError(`path "${rel}" escapes the workspace root`);
    }
    const content = typeof op.content === 'string' ? op.content : '';
    let exists = true;
    try {
      await fs.stat(target);
    } catch {
      exists = false;
    }
    const bytes = Buffer.byteLength(content, 'utf8');
    totalBytes += bytes;
    const kind = str(op.op) ?? 'create';
    resolved.push({
      op: kind,
      path: rel,
      exists,
      // Named plainly so an approving human is never surprised by an overwrite.
      effect: kind === 'delete' ? 'delete' : exists ? 'overwrite' : 'create',
      bytes,
    });
  }
  return { ops, resolved, totalBytes };
}

/** Compute a proposal. Reads the disk to classify each op; writes nothing. */
async function proposeChangeset(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const root = await assertRoot(args.rootPath);
  const { ops, resolved, totalBytes } = await resolveOps(root, args.ops ?? args.changes);
  return {
    tool,
    fileCount: resolved.length,
    totalBytes,
    changeset: { rootPath: root, ops },
    ops: resolved,
    applied: false,
  };
}

/**
 * Apply — the only path that touches the working tree, and only with a human.
 *
 * The refusal is a RESULT rather than a thrown error on purpose: "the operator
 * declined" is information the agent should reason about and explain, whereas an
 * exception reads as a malfunction and invites it to retry the same call.
 */
async function applyChangeset(
  tool: string,
  args: Record<string, unknown>,
  host: WorkspaceToolHost,
): Promise<unknown> {
  const root = await assertRoot(args.rootPath);
  const { ops, resolved } = await resolveOps(root, args.ops ?? args.changes);

  if (applyRequiresApproval(tool)) {
    const approved = await host.requestApproval({
      tool,
      fileCount: resolved.length,
      paths: resolved.map((o) => o.path),
    });
    if (!approved) {
      return {
        tool,
        applied: false,
        approved: false,
        reason: 'the operator did not approve this change',
        ops: resolved,
      };
    }
  }

  const result = await host.applyChangeset({ rootPath: root, ops });
  return { tool, applied: true, approved: true, ops: resolved, result };
}

/** Build an executor bound to this client's editor capabilities. */
export function createWorkspaceToolExecutor(host: WorkspaceToolHost) {
  return async function executeWorkspaceTool(tool: string, input: unknown): Promise<unknown> {
    const args = asRecord(input);
    const meta = workspaceToolMeta(tool);
    if (!meta) {
      // Refused BY NAME. An unknown tool answered with a plausible-looking empty
      // result is far worse than one that says it does not exist.
      throw new WorkspaceToolError(
        `${tool} is not a declared workspace tool (declared: ${WORKSPACE_TOOL_IDS.join(', ')})`,
      );
    }

    switch (tool) {
      // ── Shared implementations: the SAME functions the Brain runs ───────────
      case 'workspace.list':
        await assertRoot(args.rootPath);
        return workspaceList(args as never);
      case 'workspace.find':
        await assertRoot(args.rootPath);
        return workspaceFind(args as never);
      case 'workspace.search':
        await assertRoot(args.rootPath);
        return workspaceSearch(args as never);
      case 'file.read':
        await assertRoot(args.rootPath);
        return fileRead(args as never);
      case 'file.readRange':
        await assertRoot(args.rootPath);
        return fileReadRange(args as never);
      case 'git.status':
        await assertRoot(args.rootPath);
        return gitStatus(args as never);
      case 'git.diff':
        await assertRoot(args.rootPath);
        return gitDiff(args as never);
      case 'git.overview':
        await assertRoot(args.rootPath);
        return gitOverview(args as never);
      case 'git.history':
        await assertRoot(args.rootPath);
        return gitHistory(args as never);
      case 'git.blame':
        await assertRoot(args.rootPath);
        return gitBlame(args as never);

      // ── Editor capabilities: better HERE than in the Brain ──────────────────
      case 'diagnostics.get': {
        const root = await assertRoot(args.rootPath);
        return host.diagnostics(root, str(args.path));
      }
      case 'file.readSymbol': {
        const root = await assertRoot(args.rootPath);
        const rel = str(args.path);
        if (!rel) throw new WorkspaceToolError('path is required');
        const listed = (await host.documentSymbols(root, rel)) as {
          symbols?: Array<{ name: string; kind: string; startLine: number; endLine: number }>;
        };
        const symbols = listed.symbols ?? [];
        // The contract is ONE enclosing symbol with its source, not a listing.
        // Returning the raw list left consumers reading `.range` off undefined.
        const wantName = str(args.symbolName);
        const wantLine = typeof args.line === 'number' ? args.line : undefined;
        let picked = wantName ? symbols.find((s) => s.name === wantName) : undefined;
        if (!picked && wantLine !== undefined) {
          // Tightest span wins, so a method beats its enclosing class.
          for (const s of symbols) {
            if (s.startLine <= wantLine && wantLine <= s.endLine) {
              if (!picked || s.endLine - s.startLine < picked.endLine - picked.startLine) picked = s;
            }
          }
        }
        if (!picked) picked = symbols[0];
        if (!picked) {
          throw new WorkspaceToolError(
            `no symbol found in "${rel}"${wantName ? ` named "${wantName}"` : wantLine !== undefined ? ` covering line ${wantLine}` : ''}`,
          );
        }
        const whole = await readFileRange(root, rel, picked.startLine, picked.endLine);
        return {
          tool: 'file.readSymbol',
          path: rel,
          symbolName: picked.name,
          kind: SYMBOL_KIND[picked.kind.toLowerCase()] ?? 'unknown',
          range: { startLine: picked.startLine, endLine: picked.endLine },
          content: whole,
        };
      }

      // ── Proposals (read-only) and applies (human-gated) ─────────────────────
      case 'fs.proposeChangeset':
      case 'edit.preview':
        return proposeChangeset(tool, args);
      case 'fs.applyChangeset':
      case 'edit.apply':
        return applyChangeset(tool, args, host);

      default:
        // Declared in the registry but not routed here — a real gap, named as one.
        throw new WorkspaceToolError(`${tool} is declared but this client has no adapter for it yet`);
    }
  };
}

export type WorkspaceToolExecutor = ReturnType<typeof createWorkspaceToolExecutor>;
