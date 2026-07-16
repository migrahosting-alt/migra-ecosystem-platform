import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Exclusions, DEFAULT_MIGRAAI_EXCLUSIONS } from '../src/engine/rag/exclusions.js';
import { chunkFile, detectLanguage } from '../src/engine/rag/chunker.js';
import { FakeEmbedder, CachedEmbedder, cosine, type Embedder } from '../src/engine/rag/embedder.js';
import { VectorIndex, type IndexedChunk } from '../src/engine/rag/vectorIndex.js';
import { hybridRetrieve } from '../src/engine/rag/hybridRetriever.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';

const A: Scope = { owner: 'local', workspace: '/ws/A' };
const B: Scope = { owner: 'local', workspace: '/ws/B' };

// ── Exclusions ─────────────────────────────────────────────────────────────
test('exclusions: secrets / binary / generated / gitignore / MigraAI list', () => {
  const e = new Exclusions({ gitignore: 'private/\n*.local', extra: DEFAULT_MIGRAAI_EXCLUSIONS });
  for (const p of ['.env', 'config/.env.production', 'server.pem', 'id_rsa', 'app/credentials.json', 'dump.sql', 'db.sqlite3'])
    assert.equal(e.isExcluded(p), true, `secret should be excluded: ${p}`);
  assert.equal(e.reason('.env'), 'secret');
  for (const p of ['logo.png', 'app.pdf', 'model.gguf']) assert.equal(e.isExcluded(p), true, `binary: ${p}`);
  for (const p of ['node_modules/x/i.js', 'dist/out.js', 'a.min.js', 'package-lock.json', 'x.d.ts']) assert.equal(e.isExcluded(p), true, `generated: ${p}`);
  assert.equal(e.isExcluded('private/secret.txt'), true, 'gitignore dir');
  assert.equal(e.isExcluded('notes.local'), true, 'gitignore glob');
  assert.equal(e.isExcluded('model-qualification.json'), true, 'MigraAI list');
  assert.equal(e.isExcluded('src/index.ts'), false, 'normal source is NOT excluded');
});

// ── Chunker ────────────────────────────────────────────────────────────────
test('chunker: language-aware boundaries + metadata', () => {
  assert.equal(detectLanguage('a/b.ts'), 'typescript');
  const code = chunkFile('src/x.ts', 'import y from "y";\nexport function foo() {\n  return 1;\n}\nexport class Bar {\n  m() {}\n}\n');
  assert.ok(code.length >= 2);
  assert.ok(code.some((c) => c.symbol === 'foo'));
  assert.ok(code.some((c) => c.symbol === 'Bar'));
  assert.ok(code.every((c) => c.startLine >= 1 && c.endLine >= c.startLine && c.contentHash && c.language === 'typescript'));

  const md = chunkFile('README.md', '# Title\nintro\n## Setup\nsteps\n## Usage\nrun\n');
  assert.ok(md.some((c) => c.symbol === 'Setup') && md.some((c) => c.symbol === 'Usage'));

  const big = 'x'.repeat(5000);
  const windows = chunkFile('big.txt', Array.from({ length: 400 }, (_, i) => `line ${i} ${big.slice(0, 10)}`).join('\n'));
  assert.ok(windows.length > 1, 'oversized content is windowed');
  assert.ok(windows.every((c) => c.text.length <= 1600 + 100));
});

// ── Embedder cache ─────────────────────────────────────────────────────────
class CountingEmbedder implements Embedder {
  readonly model = 'count'; readonly version = 'v0'; calls = 0; texts = 0;
  constructor(private readonly inner: Embedder) {}
  async embed(t: string[]): Promise<number[][]> { this.calls += 1; this.texts += t.length; return this.inner.embed(t); }
}

test('embedder cache: unchanged text is not re-embedded', async () => {
  const counting = new CountingEmbedder(new FakeEmbedder());
  const cached = new CachedEmbedder(counting);
  await cached.embed(['alpha', 'beta']);
  await cached.embed(['alpha', 'beta', 'gamma']); // only gamma is new
  assert.equal(counting.texts, 3, 'alpha/beta cached, only gamma re-embedded');
  assert.equal(cached.cacheSize(), 3);
});

test('cosine similarity basics', async () => {
  const [a, b, c] = await new FakeEmbedder().embed(['auth login token', 'auth login token', 'banana bread recipe']);
  assert.ok(cosine(a!, b!) > 0.99, 'identical text ~1');
  assert.ok(cosine(a!, c!) < cosine(a!, b!), 'different text less similar');
});

// ── Vector index ───────────────────────────────────────────────────────────
function idxChunk(ws: string, file: string, sym: string, vec: number[]): IndexedChunk {
  return { id: `${file}#1`, workspaceId: ws, filePath: file, language: 'ts', symbol: sym, startLine: 1, endLine: 5, contentHash: sym, embeddingModel: 'f', embeddingVersion: 'v0', indexedAt: 1, text: `code for ${sym}`, vector: vec };
}

test('vector index: replace/remove file, search, clone independence', () => {
  const idx = new VectorIndex();
  idx.replaceFile('a.ts', [idxChunk('/ws/A', 'a.ts', 'foo', [1, 0, 0])]);
  idx.replaceFile('b.ts', [idxChunk('/ws/A', 'b.ts', 'bar', [0, 1, 0])]);
  assert.equal(idx.size(), 2);
  const clone = idx.clone();
  idx.removeFile('a.ts');
  assert.equal(idx.size(), 1);
  assert.equal(clone.size(), 2, 'clone unaffected by mutation of original (staging isolation)');
  const hits = clone.search([1, 0, 0], 1);
  assert.equal(hits[0]!.chunk.filePath, 'a.ts');
});

// ── Hybrid retrieval ───────────────────────────────────────────────────────
test('hybrid retrieval: bounded, cited, deduped, with why-breakdown; reranker seam', async () => {
  const idx = new VectorIndex();
  const emb = new FakeEmbedder();
  const [vAuth, vAuth2, vPay] = await emb.embed(['authenticate user login jwt', 'authenticate session token', 'process payment stripe']);
  idx.replaceFile('auth.ts', [
    { ...idxChunk('/ws/A', 'auth.ts', 'authenticate', vAuth!), text: 'function authenticate(user) { verify jwt }' },
    { ...idxChunk('/ws/A', 'auth.ts', 'session', vAuth2!), startLine: 6, endLine: 10, text: 'function session() {}' },
  ]);
  idx.replaceFile('pay.ts', [{ ...idxChunk('/ws/A', 'pay.ts', 'pay', vPay!), text: 'function pay() { stripe }' }]);
  const [q] = await emb.embed(['where is authentication login enforced']);
  let rerankCalled = false;
  const res = await hybridRetrieve(idx, q!, 'where is authentication login enforced', {
    maxChunks: 2,
    reranker: { rerank: async (_q, h) => { rerankCalled = true; return h; } },
  });
  assert.ok(res.chunks.length >= 1 && res.chunks.length <= 2, 'bounded');
  assert.equal(res.chunks[0]!.filePath, 'auth.ts', 'auth chunk ranks first');
  assert.ok(res.chunks[0]!.why.semantic >= 0 && 'lexical' in res.chunks[0]!.why, 'why breakdown present');
  assert.ok(res.diagnostics.reranked && rerankCalled, 'reranker seam invoked');
});

// ── Index service (fake embedder + in-memory source) ───────────────────────
function memSource(files: Map<string, string>): FileSource {
  return { files: async () => [...files].map(([relPath, content]) => ({ relPath, content })) };
}

test('index service: create → sync → retrieve (cited), incremental, deletion cleanup', async () => {
  const files = new Map<string, string>([
    ['src/auth.ts', 'export function authenticate() { /* verify jwt token login */ }'],
    ['src/pay.ts', 'export function pay() { /* stripe charge */ }'],
  ]);
  const counting = new CountingEmbedder(new FakeEmbedder());
  const svc = new IndexService(new CachedEmbedder(counting), () => memSource(files));
  const rec = svc.createIndex(A, { root: '/ws/A' });
  assert.equal(rec.state, 'experimental');

  const s1 = await svc.sync(rec.id, A);
  assert.ok(s1.ok && s1.record.stats.chunks >= 2);
  const embedCallsAfterFirst = counting.texts;

  // Incremental: nothing changed → no new embeddings (query embed excluded here).
  const s2 = await svc.sync(rec.id, A);
  assert.ok(s2.ok);
  assert.equal(counting.texts, embedCallsAfterFirst, 'unchanged files are not re-embedded');

  // Retrieve is cited.
  const r = await svc.retrieve(rec.id, A, 'where is authentication login');
  assert.ok(r.ok && r.chunks.length >= 1);
  assert.match(r.chunks[0]!.filePath, /auth\.ts/);
  assert.ok(r.chunks[0]!.startLine >= 1 && r.chunks[0]!.endLine >= r.chunks[0]!.startLine);

  // Deletion cleanup: remove pay.ts → its chunks are invalidated.
  files.delete('src/pay.ts');
  await svc.sync(rec.id, A);
  const status = svc.status(rec.id, A)!;
  assert.equal(status.stats.files, 1, 'deleted file removed from index');
});

test('index service: partial/failed sync keeps the prior index (embedding failure → degraded)', async () => {
  const files = new Map<string, string>([['a.ts', 'export function a() {}']]);
  const good = new FakeEmbedder();
  let fail = false;
  const flaky: Embedder = { model: 'flaky', version: 'v0', embed: async (t) => { if (fail) throw new Error('embed down'); return good.embed(t); } };
  const svc = new IndexService(flaky, () => memSource(files));
  const rec = svc.createIndex(A, { root: '/ws/A' });
  await svc.sync(rec.id, A);
  const before = svc.status(rec.id, A)!.stats.chunks;
  assert.ok(before >= 1);

  files.set('b.ts', 'export function b() {}'); // a change that will need embedding
  fail = true;
  const s = await svc.sync(rec.id, A);
  assert.equal(s.ok, false);
  const after = svc.status(rec.id, A)!;
  assert.equal(after.state, 'degraded');
  assert.equal(after.stats.chunks, before, 'prior index unchanged after a failed sync');
});

test('index service: workspace isolation + approval gating', async () => {
  const files = new Map<string, string>([['x.ts', 'export function x() { login auth }']]);
  const svc = new IndexService(new FakeEmbedder(), () => memSource(files));
  const rec = svc.createIndex(A, { root: '/ws/A' });
  await svc.sync(rec.id, A);
  // Workspace B cannot see or retrieve A's index.
  assert.equal(svc.status(rec.id, B), undefined);
  assert.equal((await svc.retrieve(rec.id, B, 'login')).ok, false);
  // requireApproved gates production use until promoted.
  const gated = await svc.retrieve(rec.id, A, 'login', { requireApproved: true });
  assert.equal(gated.ok, false);
  assert.equal((gated as { code: string }).code, 'NOT_APPROVED');
  svc.setState(rec.id, A, 'approved');
  assert.equal(svc.approvedIndexFor(A), rec.id);
  assert.equal((await svc.retrieve(rec.id, A, 'login', { requireApproved: true })).ok, true);
});
