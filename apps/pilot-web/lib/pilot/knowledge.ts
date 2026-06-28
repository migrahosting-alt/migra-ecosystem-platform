// MigraPilot — knowledge / memory public API + backend dispatcher (Phase 9.4).
// Backend is file-backed by default; pgvector is used only when PILOT_MEMORY_BACKEND=pgvector
// AND DATABASE_URL are set (and the DB is reachable with the migration applied). On any
// pg failure it logs a warning and falls back to file-backed memory. Guardrails, chunking,
// directory/glob walk, and embedding are shared here so both backends apply identical safety.

import { readFile, stat, readdir } from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { embed } from "./gateway";
import { fileStorage } from "./knowledge-file";
import { pgStorage } from "./knowledge-pg";
import type { Chunk, Embedding, MemoryStorage, SearchHit, Source } from "./types";

const REPO_ROOT = process.cwd();

// --- Guardrails ---
const MAX_BYTES = 256 * 1024;
const ALLOW_EXT = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".css", ".scss", ".html", ".sh", ".py", ".sql", ".toml", ".ini", ".csv", ".xml",
]);
const DENY_DIR = ["node_modules", ".git", ".next", ".pilot-scratch", ".pilot-data", ".pilot-sd", "dist", "build", "coverage"];
const SECRET_RE = /(^\.env|\.env$|\.env\.|\.key$|\.pem$|\.crt$|\.cert$|secret|credential|\.p12$|id_rsa|-lock\.json$|lock\.yaml$|yarn\.lock$)/i;

// --- Chunking / retrieval ---
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const SCORE_THRESHOLD = 0.55;
const CONTEXT_CAP = 2200;

// --- Batch caps ---
const MAX_SCAN = 5000;
const MAX_CANDIDATES = 100;

// --- ID generation (backend-agnostic) ---
const gc = globalThis as unknown as { __migrapilotKid?: number };
function kid(prefix: string): string {
  gc.__migrapilotKid = (gc.__migrapilotKid ?? 0) + 1;
  return `${prefix}_${Date.now().toString(36)}_${gc.__migrapilotKid.toString(36)}`;
}

// --- Backend selection (cached on globalThis) ---
const gb = globalThis as unknown as { __migrapilotBackend?: MemoryStorage; __migrapilotBackendName?: "file" | "pgvector" };
function pgConfigured(): boolean {
  return process.env.PILOT_MEMORY_BACKEND === "pgvector" && !!process.env.DATABASE_URL;
}
async function backend(): Promise<MemoryStorage> {
  if (gb.__migrapilotBackend) return gb.__migrapilotBackend;
  if (pgConfigured()) {
    try {
      await pgStorage.init();
      gb.__migrapilotBackend = pgStorage;
      gb.__migrapilotBackendName = "pgvector";
      return pgStorage;
    } catch (e) {
      console.warn(`[pilot-memory] pgvector backend unavailable, falling back to file: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  await fileStorage.init();
  gb.__migrapilotBackend = fileStorage;
  gb.__migrapilotBackendName = "file";
  return fileStorage;
}
export async function memoryBackendName(): Promise<"file" | "pgvector"> {
  await backend();
  return gb.__migrapilotBackendName ?? "file";
}

// --- Guardrail helpers (shared) ---
function validatePath(relPath: string): { abs: string; rel: string } {
  if (typeof relPath !== "string" || !relPath.trim()) throw new Error("path required");
  if (isAbsolute(relPath)) throw new Error("only relative repo paths are allowed");
  const abs = resolve(REPO_ROOT, relPath);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes repo root");
  const segments = rel.split(/[\\/]/);
  if (segments.some((s) => DENY_DIR.includes(s))) throw new Error("path is in a denied directory");
  const ext = extname(abs).toLowerCase();
  if (!ALLOW_EXT.has(ext)) throw new Error(`file type '${ext || "none"}' is not allowed for ingestion (text files only)`);
  if (SECRET_RE.test(basename(abs))) throw new Error("secret-bearing / lockfile path is blocked");
  return { abs, rel };
}

function validateBase(relPath: string): { abs: string; rel: string } {
  if (typeof relPath !== "string" || !relPath.trim()) throw new Error("path required");
  if (isAbsolute(relPath)) throw new Error("only relative repo paths are allowed");
  const abs = resolve(REPO_ROOT, relPath);
  const rel = relative(REPO_ROOT, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("path escapes repo root");
  const segments = rel.split(/[\\/]/).filter(Boolean);
  if (segments.some((s) => DENY_DIR.includes(s))) throw new Error("path is in a denied directory");
  return { abs, rel };
}

function fileRejectReason(rel: string): string | null {
  const ext = extname(rel).toLowerCase();
  if (!ALLOW_EXT.has(ext)) return `file type '${ext || "none"}' not allowed`;
  if (SECRET_RE.test(basename(rel))) return "secret-bearing / lockfile";
  return null;
}

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n");
  const out: string[] = [];
  for (let i = 0; i < clean.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const piece = clean.slice(i, i + CHUNK_SIZE).trim();
    if (piece) out.push(piece);
    if (i + CHUNK_SIZE >= clean.length) break;
  }
  if (out.length === 0) {
    const t = clean.trim();
    if (t) out.push(t);
  }
  return out;
}

// --- Ingestion / search orchestration (backend-agnostic) ---
export async function ingestSource(relPath: string, flushAfter = true): Promise<Source> {
  const storage = await backend();
  const { abs, rel } = validatePath(relPath);

  const info = await stat(abs);
  if (!info.isFile()) throw new Error("path is not a file");
  if (info.size > MAX_BYTES) throw new Error(`file too large: ${info.size} bytes (max ${MAX_BYTES})`);

  const content = await readFile(abs, "utf8");
  const hash = createHash("sha256").update(content).digest("hex");
  const pieces = chunkText(content);

  const source: Source = {
    id: kid("src"),
    path: rel,
    title: basename(rel),
    hash,
    bytes: info.size,
    chunkCount: pieces.length,
    createdAt: new Date().toISOString(),
  };

  const chunks: Chunk[] = [];
  const embeddings: Embedding[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const chunk: Chunk = { id: kid("chk"), sourceId: source.id, index: i, text: pieces[i] };
    const vector = await embed(pieces[i], "document");
    chunks.push(chunk);
    embeddings.push({ chunkId: chunk.id, vector });
  }

  await storage.replaceSource(source, chunks, embeddings);
  if (flushAfter) await storage.flush();
  return source;
}

type Candidate = { path: string; bytes: number };
type Rejected = { path: string; reason: string };

async function collectCandidates(inputRel: string, glob?: string): Promise<{ candidates: Candidate[]; rejected: Rejected[]; truncated: boolean }> {
  const base = validateBase(inputRel);
  const candidates: Candidate[] = [];
  const rejected: Rejected[] = [];
  const globRe = glob && glob.trim() ? globToRegExp(glob.trim()) : null;
  let scanned = 0;
  let truncated = false;

  const consider = async (abs: string) => {
    const rel = relative(REPO_ROOT, abs);
    const relToBase = relative(base.abs, abs);
    if (globRe && !globRe.test(relToBase)) return;
    const reason = fileRejectReason(rel);
    if (reason) {
      rejected.push({ path: rel, reason });
      return;
    }
    let size = 0;
    try {
      size = (await stat(abs)).size;
    } catch {
      rejected.push({ path: rel, reason: "unreadable" });
      return;
    }
    if (size > MAX_BYTES) {
      rejected.push({ path: rel, reason: `too large (${size} bytes, max ${MAX_BYTES})` });
      return;
    }
    if (candidates.length >= MAX_CANDIDATES) {
      truncated = true;
      return;
    }
    candidates.push({ path: rel, bytes: size });
  };

  const baseInfo = await stat(base.abs);
  if (baseInfo.isFile()) {
    await consider(base.abs);
    return { candidates, rejected, truncated };
  }

  const walk = async (dirAbs: string): Promise<void> => {
    if (scanned >= MAX_SCAN || candidates.length >= MAX_CANDIDATES) {
      truncated = true;
      return;
    }
    let entries;
    try {
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (scanned >= MAX_SCAN) { truncated = true; break; }
      scanned++;
      if (entry.isSymbolicLink()) continue; // never follow symlinks
      const childAbs = resolve(dirAbs, entry.name);
      if (entry.isDirectory()) {
        if (DENY_DIR.includes(entry.name)) continue;
        await walk(childAbs);
      } else if (entry.isFile()) {
        await consider(childAbs);
      }
    }
  };

  await walk(base.abs);
  return { candidates, rejected, truncated };
}

export async function ingestBatch(inputRel: string, glob: string | undefined, dryRun: boolean) {
  const storage = await backend();
  const { candidates, rejected, truncated } = await collectCandidates(inputRel, glob);

  if (dryRun) {
    return { dryRun: true as const, candidateCount: candidates.length, rejectedCount: rejected.length, candidates, rejected, truncated };
  }

  const ingested: { path: string; chunkCount: number }[] = [];
  for (const c of candidates) {
    try {
      const src = await ingestSource(c.path, false);
      ingested.push({ path: c.path, chunkCount: src.chunkCount });
    } catch (e) {
      rejected.push({ path: c.path, reason: e instanceof Error ? e.message : "ingest failed" });
    }
  }
  await storage.flush();
  const stats = await storage.getStats();

  return {
    dryRun: false as const,
    ingestedCount: ingested.length,
    chunkCount: ingested.reduce((a, b) => a + b.chunkCount, 0),
    ingested,
    rejected,
    rejectedCount: rejected.length,
    sourceCount: stats.sourceCount,
    totalChunks: stats.chunkCount,
    truncated,
  };
}

export async function searchKnowledge(query: string, k = 5): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const storage = await backend();
  const stats = await storage.getStats();
  if (stats.chunkCount === 0) return [];
  const qv = await embed(query, "query");
  return storage.searchVectors(qv, k);
}

// Auto-retrieval: bounded context + the sources actually injected, or null when nothing is confident enough.
export async function retrieveContext(query: string): Promise<{ text: string; sources: { title: string; path: string }[] } | null> {
  const storage = await backend();
  const stats = await storage.getStats();
  if (stats.sourceCount === 0) return null;

  const hits = (await searchKnowledge(query, 4)).filter((h) => h.score >= SCORE_THRESHOLD);
  if (hits.length === 0) return null;

  let context = "Relevant context from the user's knowledge sources (cite the source path when you use it):\n";
  const seen = new Set<string>();
  const sources: { title: string; path: string }[] = [];
  for (const h of hits) {
    const line = `\n[${h.title} — ${h.path}] ${h.snippet}\n`;
    if (context.length + line.length > CONTEXT_CAP) break;
    context += line;
    if (!seen.has(h.path)) {
      seen.add(h.path);
      sources.push({ title: h.title, path: h.path });
    }
  }
  return { text: context, sources };
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "(no matching knowledge)";
  return hits.map((h) => `• ${h.title} — ${h.path} (score ${h.score.toFixed(2)})\n  ${h.snippet}`).join("\n");
}

export async function listSources(): Promise<Source[]> {
  return (await backend()).listSources();
}

export async function knowledgeStats(): Promise<{ sourceCount: number; chunkCount: number; lastIngest: string | null }> {
  return (await backend()).getStats();
}
