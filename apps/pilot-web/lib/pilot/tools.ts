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
        return clip(`[provider:sdxl] ${r.status}: ${r.message}${r.result ? " " + JSON.stringify(r.result).slice(0, 300) : ""}`);
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
