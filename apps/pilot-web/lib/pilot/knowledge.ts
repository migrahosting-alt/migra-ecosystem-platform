// MigraPilot — knowledge / memory store (Phase 9.1).
// File-backed (.pilot-data/*.json), local-first, no DB. Embeddings via nomic-embed-text.
// globalThis-cached so we don't re-read files every call; write-through on mutation.

import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, basename, extname } from "node:path";
import { createHash } from "node:crypto";
import { embed } from "./gateway";
import type { Chunk, Embedding, SearchHit, Source } from "./types";

const REPO_ROOT = process.cwd();
const DATA_DIR = resolve(REPO_ROOT, ".pilot-data");
const SOURCES_FILE = resolve(DATA_DIR, "sources.json");
const CHUNKS_FILE = resolve(DATA_DIR, "chunks.json");
const EMB_FILE = resolve(DATA_DIR, "embeddings.json");

// --- Guardrails ---
const MAX_BYTES = 256 * 1024;
const ALLOW_EXT = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".json", ".yml", ".yaml", ".css", ".scss", ".html", ".sh", ".py", ".sql", ".toml", ".ini", ".csv", ".xml",
]);
const DENY_DIR = ["node_modules", ".git", ".next", ".pilot-scratch", ".pilot-data", ".pilot-sd", "dist", "build", "coverage"];
const SECRET_RE = /(^\.env|\.env$|\.env\.|\.key$|\.pem$|\.crt$|\.cert$|secret|credential|\.p12$|id_rsa|-lock\.json$|lock\.yaml$|yarn\.lock$)/i;

// --- Chunking ---
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const SCORE_THRESHOLD = 0.55;
const CONTEXT_CAP = 2200;

type KnowledgeStore = { sources: Source[]; chunks: Chunk[]; embeddings: Embedding[]; loaded: boolean; counter: number };
const g = globalThis as unknown as { __migrapilotKnowledge?: KnowledgeStore };
const kb: KnowledgeStore =
  g.__migrapilotKnowledge ?? (g.__migrapilotKnowledge = { sources: [], chunks: [], embeddings: [], loaded: false, counter: 0 });

function kid(prefix: string): string {
  kb.counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${kb.counter.toString(36)}`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function ensureLoaded(): Promise<void> {
  if (kb.loaded) return;
  kb.sources = await readJson<Source[]>(SOURCES_FILE, []);
  kb.chunks = await readJson<Chunk[]>(CHUNKS_FILE, []);
  kb.embeddings = await readJson<Embedding[]>(EMB_FILE, []);
  kb.loaded = true;
}

async function persist(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(SOURCES_FILE, JSON.stringify(kb.sources));
  await writeFile(CHUNKS_FILE, JSON.stringify(kb.chunks));
  await writeFile(EMB_FILE, JSON.stringify(kb.embeddings));
}

// Validate + resolve a repo-relative path under all ingestion guardrails. Throws on violation.
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

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export async function ingestSource(relPath: string): Promise<Source> {
  await ensureLoaded();
  const { abs, rel } = validatePath(relPath);

  const info = await stat(abs);
  if (!info.isFile()) throw new Error("path is not a file");
  if (info.size > MAX_BYTES) throw new Error(`file too large: ${info.size} bytes (max ${MAX_BYTES})`);

  const content = await readFile(abs, "utf8");
  const hash = createHash("sha256").update(content).digest("hex");

  // Re-ingest: drop any prior source for this path (+ its chunks/embeddings).
  const prior = kb.sources.find((s) => s.path === rel);
  if (prior) {
    const dropIds = new Set(kb.chunks.filter((c) => c.sourceId === prior.id).map((c) => c.id));
    kb.chunks = kb.chunks.filter((c) => c.sourceId !== prior.id);
    kb.embeddings = kb.embeddings.filter((e) => !dropIds.has(e.chunkId));
    kb.sources = kb.sources.filter((s) => s.id !== prior.id);
  }

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

  for (let i = 0; i < pieces.length; i++) {
    const chunk: Chunk = { id: kid("chk"), sourceId: source.id, index: i, text: pieces[i] };
    const vector = await embed(pieces[i], "document");
    kb.chunks.push(chunk);
    kb.embeddings.push({ chunkId: chunk.id, vector });
  }

  kb.sources.push(source);
  await persist();
  return source;
}

export async function searchKnowledge(query: string, k = 5): Promise<SearchHit[]> {
  await ensureLoaded();
  if (kb.embeddings.length === 0 || !query.trim()) return [];

  const qv = await embed(query, "query");
  const chunkById = new Map(kb.chunks.map((c) => [c.id, c]));
  const sourceById = new Map(kb.sources.map((s) => [s.id, s]));

  const scored = kb.embeddings
    .map((e) => {
      const chunk = chunkById.get(e.chunkId);
      if (!chunk) return null;
      const source = sourceById.get(chunk.sourceId);
      return {
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        title: source?.title ?? "(unknown)",
        path: source?.path ?? "(unknown)",
        score: cosine(qv, e.vector),
        snippet: chunk.text.replace(/\s+/g, " ").slice(0, 300),
      } satisfies SearchHit;
    })
    .filter((h): h is SearchHit => h !== null)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, Math.max(1, Math.min(k, 20)));
}

// Auto-retrieval: bounded context string for injection, or null when nothing is confident enough.
export async function retrieveContext(query: string): Promise<string | null> {
  if (kb.loaded && kb.sources.length === 0) return null;
  await ensureLoaded();
  if (kb.sources.length === 0) return null;

  const hits = (await searchKnowledge(query, 4)).filter((h) => h.score >= SCORE_THRESHOLD);
  if (hits.length === 0) return null;

  let context = "Relevant context from the user's knowledge sources (cite the source path when you use it):\n";
  for (const h of hits) {
    const line = `\n[${h.title} — ${h.path}] ${h.snippet}\n`;
    if (context.length + line.length > CONTEXT_CAP) break;
    context += line;
  }
  return context;
}

export function formatHits(hits: SearchHit[]): string {
  if (hits.length === 0) return "(no matching knowledge)";
  return hits.map((h) => `• ${h.title} — ${h.path} (score ${h.score.toFixed(2)})\n  ${h.snippet}`).join("\n");
}

export async function listSources(): Promise<Source[]> {
  await ensureLoaded();
  return [...kb.sources].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function knowledgeStats(): Promise<{ sourceCount: number; chunkCount: number; lastIngest: string | null }> {
  await ensureLoaded();
  const lastIngest = kb.sources.reduce<string | null>((acc, s) => (acc && acc > s.createdAt ? acc : s.createdAt), null);
  return { sourceCount: kb.sources.length, chunkCount: kb.chunks.length, lastIngest };
}
