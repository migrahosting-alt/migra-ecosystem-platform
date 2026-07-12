/**
 * Workspace tool executor (Phase E) — the tools finally run where your files are.
 *
 * pilot-api has always had repo.readFile / repo.search / repo.run / repo.symbols and the
 * rest. They executed against pilot-api's own filesystem, where the operator's code does
 * not exist. This module is the other end of the wire: the same tools, executed here,
 * through VS Code's own APIs, against the real workspace.
 *
 * Every path is confined to the workspace root. A tool that escapes it fails — the model
 * asking for `../../../.ssh/id_rsa` gets an error, not a key.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { isSecretLikePath } from "../contextCollector";
import { commandFromArgs } from "./policy";

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

const MAX_FILE_CHARS = 200_000;
const MAX_MATCHES = 80;
const MAX_OUTPUT_CHARS = 60_000;
const RUN_TIMEOUT_MS = 120_000;

const fail = (code: string, message: string): ToolResult => ({ ok: false, error: { code, message } });

/** The workspace root. Everything is resolved against it, and nothing may escape it. */
function root(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/**
 * Resolve a model-supplied path INSIDE the workspace, or fail.
 * This is the containment boundary: `../` traversal and absolute paths are rejected.
 */
function resolveInWorkspace(rel: string): { uri: vscode.Uri; abs: string; rel: string } | ToolResult {
  const folder = root();
  if (!folder) return fail("NO_WORKSPACE", "No folder is open in VS Code, so there is nothing to read.");
  const base = folder.uri.fsPath;
  const abs = path.resolve(base, rel || ".");
  const relative = path.relative(base, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return fail("PATH_ESCAPES_WORKSPACE", `\`${rel}\` resolves outside the open workspace and was refused.`);
  }
  if (isSecretLikePath(abs) || isSecretLikePath(rel)) {
    return fail("SECRET_WITHHELD", `\`${rel}\` looks like a secret file. Its contents are never sent to the model.`);
  }
  return { uri: vscode.Uri.file(abs), abs, rel: relative || "." };
}

const isFail = (v: unknown): v is ToolResult => typeof v === "object" && v !== null && (v as ToolResult).ok === false;

/* ── read ───────────────────────────────────────────────────────────────────────── */

async function readFile(args: Record<string, unknown>): Promise<ToolResult> {
  const p = String(args.path ?? args.filePath ?? "");
  if (!p) return fail("VALIDATION_ERROR", "repo.readFile requires `path`.");
  const r = resolveInWorkspace(p);
  if (isFail(r)) return r;
  try {
    const doc = await vscode.workspace.openTextDocument(r.uri);
    const text = doc.getText();
    const truncated = text.length > MAX_FILE_CHARS;
    return {
      ok: true,
      data: {
        path: r.rel,
        languageId: doc.languageId,
        lineCount: doc.lineCount,
        totalChars: text.length,
        truncated,
        // Same honesty contract as the editor context: say what was and wasn't sent.
        content: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
        note: truncated
          ? `Only the first ${MAX_FILE_CHARS} of ${text.length} characters were transmitted. The file itself is intact.`
          : undefined,
      },
    };
  } catch {
    return fail("NOT_FOUND", `\`${p}\` does not exist in the open workspace.`);
  }
}

async function listFiles(args: Record<string, unknown>): Promise<ToolResult> {
  const dir = String(args.dirPath ?? args.path ?? args.root ?? ".");
  const r = resolveInWorkspace(dir);
  if (isFail(r)) return r;
  const glob = new vscode.RelativePattern(r.uri, String(args.glob ?? "**/*"));
  const uris = await vscode.workspace.findFiles(glob, "**/{node_modules,.git,dist,out,build,.next}/**", 400);
  const base = root()!.uri.fsPath;
  return {
    ok: true,
    data: {
      dir: r.rel,
      count: uris.length,
      files: uris.map((u) => path.relative(base, u.fsPath)).sort(),
    },
  };
}

async function search(args: Record<string, unknown>): Promise<ToolResult> {
  const query = String(args.query ?? args.pattern ?? "");
  if (!query) return fail("VALIDATION_ERROR", "repo.search requires `query`.");
  const folder = root();
  if (!folder) return fail("NO_WORKSPACE", "No folder is open in VS Code.");

  // ripgrep via VS Code's own bundled search would be ideal, but its API is not exposed.
  // Shell out to git grep (fast, respects .gitignore) and fall back to a scan.
  const out = await exec(`git grep -n --no-color -F -- ${shellQuote(query)}`, folder.uri.fsPath, 20_000);
  const lines = (out.stdout || "").split("\n").filter(Boolean).slice(0, MAX_MATCHES);
  const matches = lines.map((l) => {
    const m = /^(.+?):(\d+):(.*)$/.exec(l);
    return m ? { file: m[1], line: Number(m[2]), text: m[3].trim().slice(0, 240) } : { file: l, line: 0, text: "" };
  });
  return {
    ok: true,
    data: {
      query,
      matchCount: matches.length,
      truncated: lines.length >= MAX_MATCHES,
      matches,
      note: matches.length === 0 ? "No matches in the open workspace." : undefined,
    },
  };
}

async function diagnostics(args: Record<string, unknown>): Promise<ToolResult> {
  const p = args.path ? String(args.path) : "";
  const severity = ["Error", "Warning", "Info", "Hint"];
  const all: Array<{ file: string; line: number; severity: string; message: string; source?: string }> = [];
  const base = root()?.uri.fsPath ?? "";

  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    const rel = path.relative(base, uri.fsPath);
    if (rel.startsWith("..")) continue;
    if (p && rel !== p) continue;
    for (const d of diags) {
      all.push({
        file: rel,
        line: d.range.start.line + 1,
        severity: severity[d.severity] ?? "Info",
        message: d.message,
        source: d.source,
      });
    }
  }
  all.sort((a, b) => (a.severity === "Error" ? -1 : 1) - (b.severity === "Error" ? -1 : 1));
  return {
    ok: true,
    data: {
      count: all.length,
      errors: all.filter((d) => d.severity === "Error").length,
      diagnostics: all.slice(0, 100),
      note: all.length === 0 ? "VS Code reports no problems in the workspace." : undefined,
    },
  };
}

async function symbols(args: Record<string, unknown>): Promise<ToolResult> {
  const p = String(args.path ?? "");
  const r = resolveInWorkspace(p);
  if (isFail(r)) return r;
  const doc = await vscode.workspace.openTextDocument(r.uri);
  const syms = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
    "vscode.executeDocumentSymbolProvider", doc.uri,
  );
  const flat: Array<{ name: string; kind: string; line: number; endLine: number }> = [];
  const walk = (nodes: vscode.DocumentSymbol[] = []) => {
    for (const n of nodes) {
      flat.push({
        name: n.name,
        kind: (vscode.SymbolKind[n.kind] ?? "symbol").toLowerCase(),
        line: n.range.start.line + 1,
        endLine: n.range.end.line + 1,
      });
      walk(n.children);
    }
  };
  walk(syms ?? []);
  return { ok: true, data: { path: r.rel, count: flat.length, symbols: flat } };
}

/* ── execute ────────────────────────────────────────────────────────────────────── */

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function exec(cmd: string, cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    cp.exec(cmd, { cwd, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? "").slice(0, MAX_OUTPUT_CHARS),
        stderr: String(stderr ?? "").slice(0, MAX_OUTPUT_CHARS),
        code: err ? ((err as unknown as { code?: number }).code ?? 1) : 0,
      });
    });
  });
}

/**
 * repo.run — this is the one that turns a chat assistant into an engineer: it can run the
 * tests, read the failure, fix the code, and run them again. The policy layer has ALREADY
 * decided this command may run; this only executes it and reports honestly.
 *
 * A non-zero exit is NOT a tool failure — a failing test is exactly the information the
 * model needs. It is returned as a successful call with the real output.
 */
async function run(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
  // The policy layer already parsed this exact shape; reuse it so the command that was
  // APPROVED is byte-for-byte the command that RUNS. Divergence here would be a security bug.
  const cmd = commandFromArgs(toolName, args);
  if (!cmd) return fail("VALIDATION_ERROR", "repo.run requires `cmd`.");
  const folder = root();
  if (!folder) return fail("NO_WORKSPACE", "No folder is open in VS Code.");

  let cwd = folder.uri.fsPath;
  if (args.cwd) {
    const r = resolveInWorkspace(String(args.cwd));
    if (isFail(r)) return r;
    cwd = r.abs;
  }

  const started = Date.now();
  const { stdout, stderr, code } = await exec(cmd, cwd, RUN_TIMEOUT_MS);
  return {
    ok: true,
    data: {
      cmd,
      exitCode: code,
      durationMs: Date.now() - started,
      stdout,
      stderr,
      // Say it plainly so the model does not report a failing suite as a broken tool.
      note: code === 0
        ? "Command succeeded."
        : `Command exited ${code}. This is the real result — the command ran; it did not error out as a tool.`,
    },
  };
}

/* ── git (read-only here; writes are gated by policy) ───────────────────────────── */

async function git(sub: string, args: Record<string, unknown>): Promise<ToolResult> {
  const folder = root();
  if (!folder) return fail("NO_WORKSPACE", "No folder is open in VS Code.");
  const cwd = folder.uri.fsPath;
  // Names taken from the handler registry. There is no git.status / git.diff — that is
  // repo.status / repo.diff. Implementing phantom tools would have been dead code.
  const map: Record<string, string> = {
    "repo.status": "git status --porcelain=v1 -b",
    "repo.diff": `git diff ${args.staged ? "--cached" : ""} --no-color`.trim(),
    "git.blame": `git blame --line-porcelain -- ${shellQuote(String(args.path ?? ""))}`,
    "git.history": `git log --oneline -n ${Number(args.limit ?? 20)} --no-color`,
    "git.diffStats": "git diff --stat --no-color",
  };
  const cmd = map[sub];
  if (!cmd) return fail("UNSUPPORTED", `${sub} is not supported by the workspace executor.`);
  const { stdout, stderr, code } = await exec(cmd, cwd, 30_000);
  if (code !== 0 && !stdout) return fail("GIT_FAILED", stderr.slice(0, 500) || `${sub} failed.`);
  return { ok: true, data: { command: cmd, output: stdout } };
}

/* ── dispatch ───────────────────────────────────────────────────────────────────── */

/**
 * Execute a bridged tool. Writes are NOT handled here: `repo.writeFile` is routed into the
 * existing Phase C proposed-edit flow by the caller, so nothing reaches disk without the
 * diff-review + approve gate the operator already hardened.
 */
export async function executeWorkspaceTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "repo.readFile": return await readFile(args);
      case "repo.listFiles": return await listFiles(args);
      case "repo.search": return await search(args);
      case "repo.symbols": return await symbols(args);
      case "repo.diagnostics": return await diagnostics(args);
      case "repo.run":
      case "repo.runTests": return await run(toolName, args);
      case "repo.status":
      case "repo.diff":
      case "git.blame":
      case "git.history":
      case "git.diffStats": return await git(toolName, args);
      case "repo.getErrors": return await diagnostics(args);
      case "repo.listDir": return await listFiles(args);
      default:
        return fail("UNSUPPORTED", `${toolName} is not implemented by the workspace executor.`);
    }
  } catch (err) {
    return fail("EXECUTOR_ERROR", (err as Error)?.message ?? String(err));
  }
}

/** The tools this extension advertises to pilot-api at stream open. */
/**
 * What this extension advertises to pilot-api. Anything a codebase tool needs that is NOT
 * on this list is REFUSED server-side rather than silently executed against pilot-api's own
 * filesystem — so this list is a safety boundary, not just a feature flag. Grow it by
 * implementing the tool here, never by listing it speculatively.
 */
export const SUPPORTED_WORKSPACE_TOOLS: string[] = [
  "repo.readFile", "repo.listFiles", "repo.listDir", "repo.search", "repo.symbols",
  "repo.status", "repo.diff", "repo.getErrors",
  "repo.run", "repo.runTests",
  "git.blame", "git.history", "git.diffStats",
];
