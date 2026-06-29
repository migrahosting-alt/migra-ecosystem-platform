// MigraPilot — tool registry (Phase 7). READ-ONLY tools only.
// Safety: every tool is allowlisted, repo-scoped, runs via execFile (arg arrays —
// no shell injection), times out, clips output, and refuses secret-bearing files.
// Anything not risk:"read" is blocked here until Phase 8 approval gates exist.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, relative, isAbsolute, basename } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { visionAnalyze } from "./gateway";
import { formatHits, ingestBatch, searchKnowledge } from "./knowledge";
import { imageHealth, imagePreview, imageProviderMode, submitImageJob } from "./image-provider";
import { buildHealthBundle, buildOpsPlan, buildReport, buildRunbook, checkUrl, executeNoop, hazardLookup, knownTopology, listStatusMarkers, opsHealth, previewHealthBundle, previewReport, previewRunbook, previewWebhookSim, sendWebhookSim, setStatusMarker, verifyDeploy, verifyNoop, verifyPlan, verifyService, verifyStatusMarker, verifyUrl, verifyWebhookSim } from "./ops-provider";
import { listOpsActions } from "./ops-action-registry";

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

// Resolve a safe OUTPUT path inside the .pilot-scratch sandbox (mutating tools write here only).
function scratchOut(name: string): string {
  const safe = String(name).replace(/[^a-zA-Z0-9._-]/g, "_") || "out.png";
  const abs = resolve(SCRATCH_DIR, safe);
  if (abs !== SCRATCH_DIR && !abs.startsWith(SCRATCH_DIR + "/")) throw new Error("path escapes scratch sandbox");
  return abs;
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd: REPO_ROOT, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 });
  return stdout.trim() || "(no output)";
}

// ---- Coding hand (Phase 10.3) ----------------------------------------------
const MAX_CODE_BYTES = 256 * 1024; // 256KB max per-file content
const CODE_EXT_ALLOW = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".css", ".scss", ".html", ".txt", ".yml", ".yaml", ".sql", ".sh", ".toml"]);
const LOCKFILE_RE = /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;

// Resolve + guard a path for code edits: relative, inside repo root, not secrets/env/keys/lockfiles/.git,
// not the pilot's own data dirs, and only code/text extensions.
function safeCodePath(p: string): { abs: string; rel: string } {
  if (typeof p !== "string" || !p.trim()) throw new Error("path required");
  if (isAbsolute(p)) throw new Error("absolute paths are not allowed");
  const abs = resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes repo root");
  const base = basename(abs);
  if (SECRET_RE.test(base)) throw new Error("editing secret/env/key files is blocked");
  if (LOCKFILE_RE.test(base)) throw new Error("editing lockfiles is blocked");
  if (/(^|[/\\])\.git([/\\]|$)/.test(rel)) throw new Error("editing .git is blocked");
  if (/^(\.pilot-data|\.pilot-scratch|\.pilot-sd|node_modules|\.next)([/\\]|$)/.test(rel)) throw new Error("editing this directory is blocked");
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".")).toLowerCase() : "";
  if (!CODE_EXT_ALLOW.has(ext)) throw new Error(`editing '${ext || "(no extension)"}' files is not allowed — code/text files only`);
  return { abs, rel };
}

// Minimal LCS line diff for human-readable previews. Bounded; never writes anything.
function lineDiff(oldText: string, newText: string): { added: number; removed: number; patch: string } {
  const a = oldText.length ? oldText.split("\n") : [];
  const b = newText.length ? newText.split("\n") : [];
  const N = a.length, M = b.length;
  if (N * M > 4_000_000) return { added: M, removed: N, patch: `(files too large for an inline diff: -${N}/+${M} lines)` };
  const dp: number[][] = Array.from({ length: N + 1 }, () => new Array(M + 1).fill(0));
  for (let i = N - 1; i >= 0; i--)
    for (let j = M - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let added = 0, removed = 0, i = 0, j = 0;
  while (i < N && j < M) {
    if (a[i] === b[j]) { out.push("  " + a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push("- " + a[i]); removed++; i++; }
    else { out.push("+ " + b[j]); added++; j++; }
  }
  while (i < N) { out.push("- " + a[i++]); removed++; }
  while (j < M) { out.push("+ " + b[j++]); added++; }
  return { added, removed, patch: out.slice(0, 400).join("\n") };
}

// Allowlisted repo commands (normalized key -> argv + risk). NO shell, pipes, or redirects.
const REPO_COMMANDS: Record<string, { argv: string[]; risk: "read" | "approval" }> = {
  "git status --short": { argv: ["git", "status", "--short"], risk: "read" },
  "git diff --stat": { argv: ["git", "diff", "--stat"], risk: "read" },
  "git diff": { argv: ["git", "diff"], risk: "read" },
  "git rev-parse --short head": { argv: ["git", "rev-parse", "--short", "HEAD"], risk: "read" },
  "npx tsc --noemit": { argv: ["npx", "tsc", "--noEmit"], risk: "approval" },
  "npm run build": { argv: ["npm", "run", "build"], risk: "approval" },
};
function normCmd(c: string): string {
  return String(c || "").trim().replace(/\s+/g, " ").toLowerCase();
}
export function repoCommandRisk(command: string): "read" | "approval" | "blocked" {
  const e = REPO_COMMANDS[normCmd(command)];
  return e ? e.risk : "blocked";
}
async function runRepoCommand(command: string): Promise<{ ok: boolean; output: string }> {
  const e = REPO_COMMANDS[normCmd(command)];
  if (!e) return { ok: false, output: `command not in allowlist (blocked): ${String(command).slice(0, 80)}` };
  try {
    const { stdout, stderr } = await execFileP(e.argv[0], e.argv.slice(1), { cwd: REPO_ROOT, timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
    return { ok: true, output: (stdout + (stderr ? "\n" + stderr : "")).trim() || "(no output)" };
  } catch (err) {
    const e2 = err as { stdout?: string; stderr?: string; message?: string };
    const out = [e2.stdout, e2.stderr, e2.message].filter(Boolean).join("\n").trim();
    return { ok: false, output: out || "command failed" };
  }
}
// Read-only repo status for the UI (HEAD + working tree), via the same allowlist.
export async function repoStatus(): Promise<{ head: string; status: string }> {
  const head = await runRepoCommand("git rev-parse --short HEAD");
  const status = await runRepoCommand("git status --short");
  return { head: head.ok ? head.output : "(unknown)", status: status.ok ? status.output : "(unavailable)" };
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
  // --- Image tools (ImageMagick). image.info is read-only; the rest write to the sandbox (approval-gated). ---
  "image.info": {
    name: "image.info",
    description: "Get an image's dimensions, format, and size (read-only). Provide 'path' relative to the app root.",
    risk: "read",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
    run: async (a) => {
      if (!a.path) throw new Error("path required");
      const abs = safePath(String(a.path));
      const { stdout } = await execFileP("identify", ["-format", "%wx%h %m %b", abs], { cwd: REPO_ROOT, timeout: TIMEOUT });
      return clip(`${relative(REPO_ROOT, abs)}: ${stdout.trim()}`);
    },
  },
  "memory.search": {
    name: "memory.search",
    description: "Semantically search the user's ingested knowledge sources and return the most relevant snippets (read-only). Provide 'query'. Use this when the user asks about their docs, runbooks, or anything they've added to MigraPilot's knowledge.",
    risk: "read",
    parameters: { type: "object", properties: { query: { type: "string" }, k: { type: "number" } }, required: ["query"] },
    run: async (a) => {
      if (!a.query) throw new Error("query required");
      const hits = await searchKnowledge(String(a.query), Number(a.k) || 5);
      return clip(formatHits(hits));
    },
  },
  "memory.preview": {
    name: "memory.preview",
    description: "Dry-run a directory/glob ingest: list candidate files and rejected files WITHOUT writing anything to memory (read-only). Provide 'path' (a directory or file) and optional 'glob'. Call this BEFORE proposing memory.ingest.",
    risk: "read",
    parameters: { type: "object", properties: { path: { type: "string" }, glob: { type: "string" } }, required: ["path"] },
    run: async (a) => {
      if (!a.path) throw new Error("path required");
      const r = await ingestBatch(String(a.path), a.glob ? String(a.glob) : undefined, true);
      if (!r.dryRun) return "preview failed";
      const cands = r.candidates.slice(0, 20).map((c) => `  + ${c.path} (${c.bytes}b)`).join("\n");
      const rej = r.rejected.slice(0, 20).map((x) => `  - ${x.path}: ${x.reason}`).join("\n");
      return clip(`Preview of ${a.path}${a.glob ? ` (glob ${a.glob})` : ""}: ${r.candidateCount} candidate(s), ${r.rejectedCount} rejected${r.truncated ? " (truncated)" : ""}\nCandidates:\n${cands || "  (none)"}\nRejected:\n${rej || "  (none)"}`);
    },
  },
  "memory.ingest": {
    name: "memory.ingest",
    description: "Ingest a directory or glob of safe text files into memory (MUTATING — requires human approval). Provide 'path' (a directory or file) and optional 'glob'. Prefer calling memory.preview first so you and the user can see what will be ingested.",
    risk: "low",
    parameters: { type: "object", properties: { path: { type: "string" }, glob: { type: "string" } }, required: ["path"] },
    run: async (a) => {
      if (!a.path) throw new Error("path required");
      const r = await ingestBatch(String(a.path), a.glob ? String(a.glob) : undefined, false);
      if (r.dryRun) return "ingest skipped";
      return clip(`Ingested ${r.ingestedCount} file(s), ${r.chunkCount} chunk(s); ${r.rejectedCount} rejected. Memory now: ${r.sourceCount} sources / ${r.totalChunks} chunks.${r.truncated ? " (batch truncated at cap)" : ""}`);
    },
  },
  "image.health": {
    name: "image.health",
    description: "Check the image-generation provider status (disabled / configured / unavailable) and reachability (read-only). Creates nothing.",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => clip(JSON.stringify(await imageHealth())),
  },
  "image.preview": {
    name: "image.preview",
    description: "Validate and normalize an image-generation request WITHOUT submitting it (read-only). Provide 'prompt' and optional negativePrompt/width/height/steps/seed/stylePreset/count.",
    risk: "read",
    parameters: { type: "object", properties: { prompt: { type: "string" }, negativePrompt: { type: "string" }, width: { type: "number" }, height: { type: "number" }, steps: { type: "number" }, seed: { type: "number" }, stylePreset: { type: "string" }, count: { type: "number" } }, required: ["prompt"] },
    run: async (a) => {
      const r = imagePreview(a);
      return clip(r.ok ? `valid → ${r.summary}\n${JSON.stringify(r.normalized)}` : `invalid → ${r.error}`);
    },
  },
  "image.analyze": {
    name: "image.analyze",
    description: "Look at an image and answer a question about it using the vision model (read-only). Provide 'path' (a repo image) and optional 'question' (default: describe it). Use this whenever the user wants you to SEE, describe, read, or critique an image, screenshot, or design.",
    risk: "read",
    parameters: { type: "object", properties: { path: { type: "string" }, question: { type: "string" } }, required: ["path"] },
    run: async (a) => {
      if (!a.path) throw new Error("path required");
      const abs = safePath(String(a.path));
      const buf = await readFile(abs);
      if (buf.length > 8 * 1024 * 1024) throw new Error("image too large (>8MB)");
      const prompt = (a.question ? String(a.question) : "") || "Describe this image in detail.";
      const out = await visionAnalyze({ imageBase64: buf.toString("base64"), prompt });
      return clip(out || "(no description)");
    },
  },
  "image.resize": {
    name: "image.resize",
    description: "Resize an image and save into the .pilot-scratch sandbox. Provide 'path' (input), 'out' (output name) and one of 'width'/'height' (px) or 'scale' (e.g. '50%'). Aspect ratio is kept unless both width and height are given.",
    risk: "low",
    parameters: { type: "object", properties: { path: { type: "string" }, out: { type: "string" }, width: { type: "number" }, height: { type: "number" }, scale: { type: "string" } }, required: ["path", "out"] },
    run: async (a) => {
      const input = safePath(String(a.path));
      const output = scratchOut(String(a.out));
      await mkdir(SCRATCH_DIR, { recursive: true });
      let geom: string;
      if (a.scale) geom = String(a.scale);
      else if (a.width && a.height) geom = `${Number(a.width)}x${Number(a.height)}`;
      else if (a.width) geom = `${Number(a.width)}x`;
      else if (a.height) geom = `x${Number(a.height)}`;
      else throw new Error("provide width, height, or scale");
      await execFileP("convert", [input, "-resize", geom, output], { cwd: REPO_ROOT, timeout: TIMEOUT });
      return `resized -> .pilot-scratch/${basename(output)} (${geom})`;
    },
  },
  "image.convert": {
    name: "image.convert",
    description: "Convert an image to another format (chosen by the output extension) and save into .pilot-scratch. Provide 'path' (input) and 'out' (e.g. 'logo.webp').",
    risk: "low",
    parameters: { type: "object", properties: { path: { type: "string" }, out: { type: "string" } }, required: ["path", "out"] },
    run: async (a) => {
      const input = safePath(String(a.path));
      const output = scratchOut(String(a.out));
      await mkdir(SCRATCH_DIR, { recursive: true });
      await execFileP("convert", [input, output], { cwd: REPO_ROOT, timeout: TIMEOUT });
      return `converted -> .pilot-scratch/${basename(output)}`;
    },
  },
  "image.crop": {
    name: "image.crop",
    description: "Crop a WxH region at offset X,Y and save into .pilot-scratch. Provide 'path','out','width','height' and optional 'x','y' (default 0,0).",
    risk: "low",
    parameters: { type: "object", properties: { path: { type: "string" }, out: { type: "string" }, width: { type: "number" }, height: { type: "number" }, x: { type: "number" }, y: { type: "number" } }, required: ["path", "out", "width", "height"] },
    run: async (a) => {
      const input = safePath(String(a.path));
      const output = scratchOut(String(a.out));
      await mkdir(SCRATCH_DIR, { recursive: true });
      const w = Number(a.width), h = Number(a.height), x = Number(a.x || 0), y = Number(a.y || 0);
      await execFileP("convert", [input, "-crop", `${w}x${h}+${x}+${y}`, "+repage", output], { cwd: REPO_ROOT, timeout: TIMEOUT });
      return `cropped ${w}x${h}+${x}+${y} -> .pilot-scratch/${basename(output)}`;
    },
  },
  "image.annotate": {
    name: "image.annotate",
    description: "Overlay caption text on an image (e.g. a social/brand card) and save into .pilot-scratch. Provide 'path','out','text'; optional 'gravity' (north/center/south, default south), 'size' (font px, default 36), 'color' (default white).",
    risk: "low",
    parameters: { type: "object", properties: { path: { type: "string" }, out: { type: "string" }, text: { type: "string" }, gravity: { type: "string" }, size: { type: "number" }, color: { type: "string" } }, required: ["path", "out", "text"] },
    run: async (a) => {
      const input = safePath(String(a.path));
      const output = scratchOut(String(a.out));
      await mkdir(SCRATCH_DIR, { recursive: true });
      const gravity = ["north", "center", "south", "northwest", "northeast", "southwest", "southeast", "west", "east"].includes(String(a.gravity)) ? String(a.gravity) : "south";
      const size = Number(a.size) || 36;
      const color = /^[#a-zA-Z0-9]+$/.test(String(a.color ?? "")) ? String(a.color) : "white";
      await execFileP("convert", [input, "-gravity", gravity, "-pointsize", String(size), "-fill", color, "-annotate", "+0+24", String(a.text ?? ""), output], { cwd: REPO_ROOT, timeout: TIMEOUT });
      return `annotated -> .pilot-scratch/${basename(output)}`;
    },
  },
  "image.generate": {
    name: "image.generate",
    description: "Generate a NEW image from a text prompt (REQUIRES APPROVAL). Uses the configured SDXL provider when PILOT_IMAGE_PROVIDER=sdxl; otherwise the local Stable Diffusion model saved into .pilot-scratch. Provide 'prompt'; optional 'out' (local file name), width/height/steps/seed/stylePreset/count/negativePrompt.",
    risk: "low",
    parameters: { type: "object", properties: { prompt: { type: "string" }, out: { type: "string" }, width: { type: "number" }, height: { type: "number" }, steps: { type: "number" }, seed: { type: "number" }, stylePreset: { type: "string" }, count: { type: "number" }, negativePrompt: { type: "string" } }, required: ["prompt"] },
    run: async (a) => {
      // SDXL provider path (when enabled). Submits the approved request to the configured endpoint.
      if (imageProviderMode() === "sdxl") {
        const r = await submitImageJob(a);
        if (!r.ok) return clip(`[provider:sdxl] ${r.status}: ${r.message}`);
        if (r.status === "queued") return clip(`[provider:sdxl] queued job ${r.jobId ?? "(no id)"}`);
        const refs = r.images.map((im, i) => im.url ?? (im.base64 ? `image ${i + 1} (base64 ${im.mimeType ?? "image"}, ${im.base64.length} bytes)` : "image")).join(", ");
        return clip(`[provider:sdxl] generated ${r.images.length} image(s): ${refs}`);
      }
      // Local Stable Diffusion path (default / provider disabled) — unchanged.
      const py = resolve(REPO_ROOT, ".pilot-sd/venv/bin/python");
      const script = resolve(REPO_ROOT, ".pilot-sd/generate.py");
      if (!existsSync(py) || !existsSync(script)) throw new Error("image-generation backend not installed (.pilot-sd venv missing on this machine)");
      if (!a.prompt) throw new Error("prompt required");
      const output = scratchOut(String(a.out || "generated.png"));
      await mkdir(SCRATCH_DIR, { recursive: true });
      const args = [
        script,
        "--prompt", String(a.prompt),
        "--out", output,
        "--width", String(Number(a.width) || 512),
        "--height", String(Number(a.height) || 512),
        "--steps", String(Number(a.steps) || 2),
      ];
      const { stdout } = await execFileP(py, args, { cwd: REPO_ROOT, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
      return `generated -> .pilot-scratch/${basename(output)} (${stdout.trim().slice(-100)})`;
    },
  },

  "code.preview": {
    name: "code.preview",
    description: "Preview a proposed change to a repository file as a unified-style diff WITHOUT writing anything (read-only). Provide 'path' (relative repo code/text file) and 'content' (the full proposed new file content). Use this before code.apply so the user can review the diff.",
    risk: "read",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] },
    run: async (a) => {
      const { rel, abs } = safeCodePath(String(a.path ?? ""));
      const content = String(a.content ?? "");
      if (Buffer.byteLength(content) > MAX_CODE_BYTES) throw new Error(`content too large (max ${MAX_CODE_BYTES} bytes)`);
      const exists = existsSync(abs);
      const current = exists ? await readFile(abs, "utf8") : "";
      const d = lineDiff(current, content);
      return clip(`${exists ? "modify" : "create"} ${rel}\n+${d.added} -${d.removed} lines\n--- a/${rel}\n+++ b/${rel}\n${d.patch}`);
    },
  },
  "code.apply": {
    name: "code.apply",
    description: "Apply an APPROVED change to a repository file. Writes the exact proposed 'content' to 'path' (relative repo code/text file). Optional 'validate' = 'tsc' or 'build' runs that allowlisted check after writing. NEVER edits secrets/env/keys/lockfiles/.git/node_modules. Does NOT commit. Requires human approval.",
    risk: "high",
    parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" }, validate: { type: "string", enum: ["tsc", "build"] } }, required: ["path", "content"] },
    run: async (a) => {
      const { rel, abs } = safeCodePath(String(a.path ?? ""));
      const content = String(a.content ?? "");
      if (Buffer.byteLength(content) > MAX_CODE_BYTES) throw new Error(`content too large (max ${MAX_CODE_BYTES} bytes)`);
      const existed = existsSync(abs);
      await mkdir(resolve(abs, ".."), { recursive: true });
      await writeFile(abs, content, "utf8");
      let out = `${existed ? "modified" : "created"} ${rel} (${Buffer.byteLength(content)} bytes)`;
      const v = a.validate ? String(a.validate) : "";
      if (v === "tsc" || v === "build") {
        const cmd = v === "tsc" ? "npx tsc --noEmit" : "npm run build";
        const res = await runRepoCommand(cmd);
        out += `\nvalidation [${cmd}]: ${res.ok ? "PASS ✓" : "FAIL ✗"}\n${res.output.slice(0, 1500)}`;
      }
      return clip(out);
    },
  },
  "ops.health": {
    name: "ops.health",
    description: "Read-only ops diagnostics: returns the ops provider status, the allowlisted health-check URLs (sanitized), and a pass/fail summary if checks ran. Creates/changes nothing.",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => clip(JSON.stringify(await opsHealth())),
  },
  "ops.check_url": {
    name: "ops.check_url",
    description: "Read-only health check of ONE URL — allowed ONLY if it is in the PILOT_OPS_ALLOWED_HEALTH_URLS allowlist. Returns status code, latency, ok/fail, and a sanitized URL (no query/credentials). Refuses non-allowlisted URLs.",
    risk: "read",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async (a) => clip(JSON.stringify(await checkUrl(String(a.url ?? "")))),
  },
  "ops.known_topology": {
    name: "ops.known_topology",
    description: "Read-only: returns the MigraTeck/MigraHosting server topology summarized from the grounded ecosystem docs (not hardcoded). Use to answer 'which server runs X / what is its IP'.",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const t = await knownTopology();
      return clip(t.available ? `${t.detail} (source: ${t.source})\n\n${t.content}` : t.detail);
    },
  },
  "ops.hazard_lookup": {
    name: "ops.hazard_lookup",
    description: "Read-only: search the grounded ecosystem docs/hazards for a service/app/server name (e.g. 'voip-core', 'panel-api', 'deploy'). Returns matching hazard/source sections. Use before suggesting any operational action.",
    risk: "read",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const r = await hazardLookup(String(a.query ?? ""));
      if (!r.matches.length) return `${r.detail} for "${r.query}"`;
      return clip(`${r.detail} for "${r.query}":\n` + r.matches.map((m) => `• [${m.doc}] ${m.heading}: ${m.snippet}`).join("\n"));
    },
  },
  "ops.actions.list": {
    name: "ops.actions.list",
    description: "READ-ONLY. List the controlled ops action registry: which actions are enabled (only the no-op) vs DISABLED future verbs, with risk level, execution mode, prerequisites, hazards, and verification recommendations. No secrets, no execution.",
    risk: "read",
    parameters: { type: "object", properties: {} },
    run: async () => clip(JSON.stringify(listOpsActions(), null, 2)),
  },
  "ops.webhook_sim.preview": {
    name: "ops.webhook_sim.preview",
    description: "READ-ONLY. Validate a dev webhook simulation: checks enabled state, URL allowlist + userinfo, and sanitizes the payload. SENDS NOTHING. Returns a sanitized preview.",
    risk: "read",
    parameters: { type: "object", properties: { url: { type: "string" }, payload: { type: "object" } }, required: ["url"] },
    run: async (a) => clip(JSON.stringify(previewWebhookSim({ url: String(a.url ?? ""), payload: a.payload }), null, 2)),
  },
  "ops.webhook_sim.send": {
    name: "ops.webhook_sim.send",
    description: "DEV WEBHOOK SIMULATION (requires approval). Sends ONE sanitized POST only if simulation is enabled (PILOT_WEBHOOK_SIM_ENABLED=1) AND the URL is in PILOT_WEBHOOK_SIM_ALLOWED_URLS. externalMutation:false, simulated:true, mutationScope:dev_webhook_simulation — NO infrastructure mutation, no command, no deploy. Secret-like payload keys are stripped; URLs with userinfo refused; response bodies are NEVER returned. Records the result in the action journal.",
    risk: "high",
    parameters: { type: "object", properties: { url: { type: "string" }, payload: { type: "object" } }, required: ["url"] },
    run: async (a) => clip(JSON.stringify(await sendWebhookSim({ url: String(a.url ?? ""), payload: a.payload }), null, 2)),
  },
  "ops.webhook_sim.verify": {
    name: "ops.webhook_sim.verify",
    description: "READ-ONLY. Verify a dev webhook simulation journal record (by url or recordId) and report its result status. SENDS NOTHING; no response body exposed.",
    risk: "read",
    parameters: { type: "object", properties: { url: { type: "string" }, recordId: { type: "string" } } },
    run: async (a) => clip(JSON.stringify(await verifyWebhookSim({ url: a.url ? String(a.url) : undefined, recordId: a.recordId ? String(a.recordId) : undefined }), null, 2)),
  },
  "ops.status_marker.set": {
    name: "ops.status_marker.set",
    description: "Record an INTERNAL ops status marker in the action journal (requires approval). INTERNAL JOURNAL ONLY — mutated:true but externalMutation:false; performs NO infrastructure mutation, command, deploy, restart, DNS/billing/DB, SSH, or external API. Provide 'target', 'status' (planned|in_progress|verifying|completed|failed|blocked|acknowledged), 'reason'; optional 'metadata'.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" }, status: { type: "string", enum: ["planned", "in_progress", "verifying", "completed", "failed", "blocked", "acknowledged"] }, reason: { type: "string" }, metadata: { type: "object" } }, required: ["target", "status", "reason"] },
    run: async (a) => clip(JSON.stringify(await setStatusMarker({ target: String(a.target ?? ""), status: String(a.status ?? ""), reason: String(a.reason ?? ""), metadata: a.metadata }), null, 2)),
  },
  "ops.status_marker.list": {
    name: "ops.status_marker.list",
    description: "READ-ONLY. List recent internal ops status markers from the action journal (sanitized). Mutates nothing.",
    risk: "read",
    parameters: { type: "object", properties: { limit: { type: "number" } } },
    run: async (a) => clip(JSON.stringify(await listStatusMarkers(Number(a.limit) || 20), null, 2)),
  },
  "ops.status_marker.verify": {
    name: "ops.status_marker.verify",
    description: "READ-ONLY. Verify whether an internal status marker exists for a target (and optional status). Mutates nothing.",
    risk: "read",
    parameters: { type: "object", properties: { target: { type: "string" }, status: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await verifyStatusMarker({ target: String(a.target ?? ""), status: a.status ? String(a.status) : undefined }), null, 2)),
  },
  "ops.noop.execute": {
    name: "ops.noop.execute",
    description: "Execute a CONTROLLED NO-OP ops action (requires approval). Records a controlled execution to prove the approval/audit/exact-once rails. Performs NO infrastructure mutation, runs NO command, calls NO external API. Provide 'target' and 'reason'; optional 'expectedVerificationUrl', 'metadata'. Returns an execution record with mutated:false.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" }, reason: { type: "string" }, expectedVerificationUrl: { type: "string" }, metadata: { type: "object" } }, required: ["target", "reason"] },
    run: async (a) => clip(JSON.stringify(await executeNoop({ target: String(a.target ?? ""), reason: String(a.reason ?? ""), expectedVerificationUrl: a.expectedVerificationUrl ? String(a.expectedVerificationUrl) : undefined, metadata: a.metadata }), null, 2)),
  },
  "ops.noop.verify": {
    name: "ops.noop.verify",
    description: "READ-ONLY. Verify a controlled no-op action record (mutated:false) and optionally run ONE allowlisted health check if a URL is provided. Mutates nothing; URLs allowlisted + sanitized; no response body returned.",
    risk: "read",
    parameters: { type: "object", properties: { target: { type: "string" }, healthUrl: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await verifyNoop({ target: String(a.target ?? ""), healthUrl: a.healthUrl ? String(a.healthUrl) : undefined }), null, 2)),
  },
  "ops.health_bundle.preview": {
    name: "ops.health_bundle.preview",
    description: "READ-ONLY. Validate a health re-check bundle and list the planned read-only checks (URL health, grounded hazards/topology, report summary). Executes no checks, writes nothing.",
    risk: "read",
    parameters: { type: "object", properties: { target: { type: "string" }, serviceName: { type: "string" }, healthUrls: { type: "array", items: { type: "string" } }, expectedText: { type: "string" }, expectedBuildId: { type: "string" }, includeHazards: { type: "boolean" }, includeTopology: { type: "boolean" }, includeReportSummary: { type: "boolean" }, audience: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(previewHealthBundle(a as unknown as Parameters<typeof previewHealthBundle>[0]), null, 2)),
  },
  "ops.health_bundle.run": {
    name: "ops.health_bundle.run",
    description: "READ-ONLY. Run a post-change health re-check bundle: allowlisted URL health checks + grounded hazards/topology + optional report summary. URLs must be allowlisted; URLs are sanitized and response bodies are NEVER returned. Returns a structured bundle result. Executes no infrastructure command, writes nothing, mutates nothing.",
    risk: "read",
    parameters: { type: "object", properties: { target: { type: "string" }, serviceName: { type: "string" }, healthUrls: { type: "array", items: { type: "string" } }, expectedText: { type: "string" }, expectedBuildId: { type: "string" }, includeHazards: { type: "boolean" }, includeTopology: { type: "boolean" }, includeReportSummary: { type: "boolean" }, audience: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await buildHealthBundle(a as unknown as Parameters<typeof buildHealthBundle>[0]), null, 2)),
  },
  "ops.report.preview": {
    name: "ops.report.preview",
    description: "READ-ONLY. Validate ops-report inputs and show which sections will be included (and whether internal detail is redacted for the audience). Generates no report, writes nothing.",
    risk: "read",
    parameters: { type: "object", properties: { reportType: { type: "string" }, title: { type: "string" }, target: { type: "string" }, audience: { type: "string" }, includeDiagnostics: { type: "boolean" }, includeHazards: { type: "boolean" }, includeRunbook: { type: "boolean" }, includeVerification: { type: "boolean" }, includeTimeline: { type: "boolean" } }, required: ["reportType", "target"] },
    run: async (a) => clip(JSON.stringify(previewReport(a as unknown as Parameters<typeof previewReport>[0]), null, 2)),
  },
  "ops.report.generate": {
    name: "ops.report.generate",
    description: "READ-ONLY. Compile a structured ops evidence report (incident/maintenance/deployment/verification/client_summary/custom) from grounded ecosystem docs + provided inputs. Returns report content only — writes NO file, executes nothing, mutates nothing. Redacts internal detail for client/executive audiences and marks unavailable data instead of inventing it.",
    risk: "read",
    parameters: { type: "object", properties: { reportType: { type: "string" }, title: { type: "string" }, target: { type: "string" }, objective: { type: "string" }, audience: { type: "string" }, notes: { type: "string" }, includeDiagnostics: { type: "boolean" }, includeHazards: { type: "boolean" }, includeRunbook: { type: "boolean" }, includeVerification: { type: "boolean" }, includeTimeline: { type: "boolean" } }, required: ["reportType", "target"] },
    run: async (a) => clip(JSON.stringify(await buildReport(a as unknown as Parameters<typeof buildReport>[0]), null, 2)),
  },
  "ops.runbook.preview": {
    name: "ops.runbook.preview",
    description: "READ-ONLY. Validate runbook inputs and return a preview summary/checklist (which sections will be included, whether the action/target are known). Generates NO runbook and executes nothing.",
    risk: "read",
    parameters: { type: "object", properties: { actionType: { type: "string" }, target: { type: "string" }, objective: { type: "string" }, includeCommands: { type: "boolean" }, includeRollback: { type: "boolean" }, includeVerification: { type: "boolean" } }, required: ["actionType", "target"] },
    run: async (a) => clip(JSON.stringify(previewRunbook({ actionType: String(a.actionType ?? ""), target: String(a.target ?? ""), objective: a.objective ? String(a.objective) : undefined, includeCommands: a.includeCommands as boolean | undefined, includeRollback: a.includeRollback as boolean | undefined, includeVerification: a.includeVerification as boolean | undefined }), null, 2)),
  },
  "ops.runbook.generate": {
    name: "ops.runbook.generate",
    description: "Generate a HUMAN-ONLY operator runbook (command pack + hazards + rollback + verification) grounded in ecosystem docs. Requires approval. Commands are TEXT ONLY and are NEVER executed by MigraPilot. actionType: restart|deploy|dns|billing|verify|incident|custom.",
    risk: "high",
    parameters: { type: "object", properties: { actionType: { type: "string" }, target: { type: "string" }, objective: { type: "string" }, riskLevel: { type: "string" }, includeCommands: { type: "boolean" }, includeRollback: { type: "boolean" }, includeVerification: { type: "boolean" } }, required: ["actionType", "target"] },
    run: async (a) => clip(JSON.stringify(await buildRunbook({ actionType: String(a.actionType ?? ""), target: String(a.target ?? ""), objective: a.objective ? String(a.objective) : undefined, riskLevel: a.riskLevel ? String(a.riskLevel) : undefined, includeCommands: a.includeCommands as boolean | undefined, includeRollback: a.includeRollback as boolean | undefined, includeVerification: a.includeVerification as boolean | undefined }), null, 2)),
  },
  "ops.verify.url": {
    name: "ops.verify.url",
    description: "READ-ONLY. Verify an allowlisted URL is healthy (GET): returns status code, latency, ok/fail, sanitized URL, timestamp. Refuses non-allowlisted URLs. Performs no mutation.",
    risk: "read",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async (a) => clip(JSON.stringify(await verifyUrl(String(a.url ?? "")), null, 2)),
  },
  "ops.verify.service": {
    name: "ops.verify.service",
    description: "READ-ONLY. Verify a service/app by name using grounded ecosystem docs/hazards plus an optional allowlisted health URL. Returns a structured verification result. No mutation.",
    risk: "read",
    parameters: { type: "object", properties: { name: { type: "string" }, healthUrl: { type: "string" } }, required: ["name"] },
    run: async (a) => clip(JSON.stringify(await verifyService(String(a.name ?? ""), a.healthUrl ? String(a.healthUrl) : undefined), null, 2)),
  },
  "ops.verify.deploy": {
    name: "ops.verify.deploy",
    description: "READ-ONLY. Verify a deployment from read-only evidence: optional allowlisted health URL, optional expected route/status text, optional expected build id/version, plus the grounded deploy model. Deploys NOTHING.",
    risk: "read",
    parameters: { type: "object", properties: { target: { type: "string" }, healthUrl: { type: "string" }, expectedText: { type: "string" }, expectedBuildId: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await verifyDeploy(String(a.target ?? ""), { healthUrl: a.healthUrl ? String(a.healthUrl) : undefined, expectedText: a.expectedText ? String(a.expectedText) : undefined, expectedBuildId: a.expectedBuildId ? String(a.expectedBuildId) : undefined }), null, 2)),
  },
  "ops.verify.plan": {
    name: "ops.verify.plan",
    description: "READ-ONLY. Given a prior dry-run plan's action type + target, returns a checklist of read-only verification steps to run AFTER the human performs the action. Mutates nothing.",
    risk: "read",
    parameters: { type: "object", properties: { actionType: { type: "string" }, target: { type: "string" } }, required: ["actionType", "target"] },
    run: async (a) => clip(JSON.stringify(await verifyPlan(String(a.actionType ?? ""), String(a.target ?? "")), null, 2)),
  },
  "ops.restart.plan": {
    name: "ops.restart.plan",
    description: "DRY RUN / PLAN ONLY (requires approval). Generate a structured, grounded restart PLAN for a target service/host. Restarts NOTHING, runs no commands. Output is a plan for operator review.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await buildOpsPlan("restart", String(a.target ?? "")), null, 2)),
  },
  "ops.deploy.plan": {
    name: "ops.deploy.plan",
    description: "DRY RUN / PLAN ONLY (requires approval). Generate a structured, grounded deployment PLAN for a target app/service. Deploys NOTHING, runs no commands. Output is a plan for operator review.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await buildOpsPlan("deploy", String(a.target ?? "")), null, 2)),
  },
  "ops.dns.plan": {
    name: "ops.dns.plan",
    description: "DRY RUN / PLAN ONLY (requires approval). Generate a structured, grounded DNS-change PLAN for a target domain/record. Edits NO DNS, runs no commands. Output is a plan for operator review.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await buildOpsPlan("dns", String(a.target ?? "")), null, 2)),
  },
  "ops.billing.plan": {
    name: "ops.billing.plan",
    description: "DRY RUN / PLAN ONLY (requires approval). Generate a structured, grounded billing/invoice-change PLAN for a target account/invoice. Changes NO billing, runs no commands. Output is a plan for operator review.",
    risk: "high",
    parameters: { type: "object", properties: { target: { type: "string" } }, required: ["target"] },
    run: async (a) => clip(JSON.stringify(await buildOpsPlan("billing", String(a.target ?? "")), null, 2)),
  },
  "repo.command": {
    name: "repo.command",
    description: "Run ONE allowlisted repo command. Read-only (auto): 'git status --short', 'git diff --stat', 'git diff', 'git rev-parse --short HEAD'. Validation (needs approval): 'npx tsc --noEmit', 'npm run build'. Anything else is blocked. No shell, pipes, redirects, or arbitrary commands.",
    risk: "high",
    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] },
    run: async (a) => {
      const res = await runRepoCommand(String(a.command ?? ""));
      return clip(res.output);
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
  if (name === "repo.command") {
    // Dynamic per-command gate (the static tool risk is a backstop only).
    const r = repoCommandRisk(String((args || {}).command ?? ""));
    if (r === "blocked") return { ok: false, output: `command not in allowlist (blocked): ${String((args || {}).command ?? "").slice(0, 80)}` };
    if (r === "approval" && !opts?.approved) return { ok: false, output: `command requires human approval — blocked` };
  } else if (tool.risk !== "read" && !opts?.approved) {
    return { ok: false, output: `tool ${name} is mutating and requires human approval — blocked` };
  }
  try {
    return { ok: true, output: await tool.run(args || {}) };
  } catch (e) {
    return { ok: false, output: `error: ${e instanceof Error ? e.message : "unknown"}` };
  }
}
