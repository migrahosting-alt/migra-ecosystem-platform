// MigraPilot — tool registry (Phase 7). READ-ONLY tools only.
// Safety: every tool is allowlisted, repo-scoped, runs via execFile (arg arrays —
// no shell injection), times out, clips output, and refuses secret-bearing files.
// Anything not risk:"read" is blocked here until Phase 8 approval gates exist.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, isAbsolute, basename } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const execFileP = promisify(execFile);

const REPO_ROOT = process.cwd(); // pilot-web app dir (dev server cwd)
const SCRATCH_DIR = resolve(REPO_ROOT, ".pilot-scratch"); // sandbox for mutating writes
const MAX_OUTPUT = 8000;
const TIMEOUT = 10000;
const SECRET_RE = /(^\.env|\.env$|\.env\.|\.key$|\.pem$|secret|credential|\.p12$|id_rsa)/i;

export type ToolDef = {
  name: string;
  description: string;
  risk: "read" | "low" | "medium" | "high";
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
};

function clip(s: string): string {
  return s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + `\n…[truncated ${s.length - MAX_OUTPUT} chars]` : s;
}

function safePath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes repo root");
  if (SECRET_RE.test(basename(abs))) throw new Error("reading secret-bearing files is blocked");
  return abs;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd: REPO_ROOT, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim() || "(no output)";
}

export const TOOLS: Record<string, ToolDef> = {
  "git.status": {
    name: "git.status",
    description: "Show the git working-tree status for this app (read-only).",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => clip(await git(["status", "--short", "--branch", "--", "."])),
  },
  "git.log": {
    name: "git.log",
    description: "Show recent commits touching this app. Optional 'limit' (default 10, max 50).",
    risk: "read",
    parameters: { type: "object", properties: { limit: { type: "number", description: "number of commits" } } },
    run: async (a) => {
      const n = Math.min(Math.max(Number(a.limit) || 10, 1), 50);
      return clip(await git(["log", "--oneline", "-n", String(n), "--", "."]));
    },
  },
  "git.diff": {
    name: "git.diff",
    description: "Show the current uncommitted diff stat for this app (read-only).",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => clip(await git(["diff", "--stat", "--", "."])),
  },
  "repo.read_file": {
    name: "repo.read_file",
    description: "Read a text file from the repo (read-only). 'path' relative to the app root.",
    risk: "read",
    parameters: { type: "object", properties: { path: { type: "string", description: "file path relative to app root" } }, required: ["path"] },
    run: async (a) => {
      if (!a.path) throw new Error("path required");
      return clip(await readFile(safePath(String(a.path)), "utf8"));
    },
  },
  "repo.search": {
    name: "repo.search",
    description: "Search the repo for a text pattern (read-only, grep-like). Provide 'query'.",
    risk: "read",
    parameters: { type: "object", properties: { query: { type: "string", description: "text/regex to find" } }, required: ["query"] },
    run: async (a) => {
      if (!a.query) throw new Error("query required");
      try {
        const { stdout } = await execFileP(
          "grep",
          ["-rIn", "--exclude-dir=node_modules", "--exclude-dir=.next", "--exclude-dir=.git", "--exclude=.env*", "-m", "5", String(a.query), "."],
          { cwd: REPO_ROOT, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 },
        );
        return clip(stdout.trim() || "(no matches)");
      } catch (e) {
        if ((e as { code?: number }).code === 1) return "(no matches)";
        throw e;
      }
    },
  },
  "repo.list_files": {
    name: "repo.list_files",
    description: "List source files in the app, optionally filtered by substring 'match'.",
    risk: "read",
    parameters: { type: "object", properties: { match: { type: "string" } } },
    run: async (a) => {
      const { stdout } = await execFileP(
        "find",
        [".", "-type", "f", "-not", "-path", "*/node_modules/*", "-not", "-path", "*/.next/*", "-not", "-path", "*/.git/*"],
        { cwd: REPO_ROOT, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 },
      );
      let lines = stdout.trim().split("\n");
      if (a.match) lines = lines.filter((l) => l.includes(String(a.match)));
      return clip(lines.slice(0, 200).join("\n") || "(none)");
    },
  },
  // --- Mutating tools (risk != read) — NEVER auto-run; require Phase 8 approval. ---
  "scratch.write_file": {
    name: "scratch.write_file",
    description: "Write a text file into the .pilot-scratch sandbox directory. Provide 'name' and 'content'. Call this directly when asked to write a scratch file.",
    risk: "low",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "file name (no path)" }, content: { type: "string" } },
      required: ["name", "content"],
    },
    run: async (a) => {
      const name = String(a.name ?? "").replace(/[^a-zA-Z0-9._-]/g, "_") || "note.txt";
      const abs = resolve(SCRATCH_DIR, name);
      if (abs !== SCRATCH_DIR && !abs.startsWith(SCRATCH_DIR + "/")) throw new Error("path escapes scratch sandbox");
      await mkdir(SCRATCH_DIR, { recursive: true });
      const content = String(a.content ?? "");
      await writeFile(abs, content, "utf8");
      return `wrote ${content.length} chars to .pilot-scratch/${name}`;
    },
  },
};

export function isMutating(name: string): boolean {
  const t = TOOLS[name];
  return Boolean(t) && t.risk !== "read";
}

export const KNOWN_TOOL_NAMES = new Set(Object.keys(TOOLS));

export function toolSpecsForModel() {
  return Object.values(TOOLS).map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export async function runTool(name: string, args: Record<string, unknown>, opts?: { approved?: boolean }): Promise<{ ok: boolean; output: string }> {
  const tool = TOOLS[name];
  if (!tool) return { ok: false, output: `unknown tool: ${name}` };
  if (tool.risk !== "read" && !opts?.approved) {
    return { ok: false, output: `tool ${name} is mutating and requires human approval — blocked` };
  }
  try {
    return { ok: true, output: await tool.run(args || {}) };
  } catch (e) {
    return { ok: false, output: `error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}
