import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ChangesetRequest } from '@migrapilot/protocol';
import { approveEditScope, proposeEditScope } from '../../src/engine/coding/editScope.js';
import { runCodingTask } from '../../src/engine/coding/codingRun.js';
import { ChangesetProposalStore } from '../../src/tools/changeset.js';
import { nodeChangesetFs } from '../../src/tools/changesetFs.js';
import { candidateGit, withDetachedCandidate } from '../support/detachedCandidate.js';
import { FIXTURE_FILES, REQUIRED_FILES, TRAP_FILE } from './multifileCodingFixture.js';

export const WEBSITE_REQUIRED_FILES = [...REQUIRED_FILES, 'public/summary.js'] as const;
export const WEBSITE_VALIDATION = {
  id: 'website.tests',
  command: ['node', '--test', '--test-reporter=tap', 'test/orderTotals.test.js', 'test/website.test.js'],
};

const summarySource = (field: string) => [
  'export function summarizeOrder(total) {',
  `  const count = total.${field} ?? 0;`,
  '  return { total: "$" + (total.totalCents / 100).toFixed(2), excluded: count + " cancelled item" + (count === 1 ? "" : "s") + " excluded" };',
  '}',
  '',
].join('\n');

export const WEBSITE_FILES: Record<string, string> = {
  ...FIXTURE_FILES,
  'package.json': JSON.stringify({
    name: 'migrapilot-website-acceptance', private: true, type: 'module',
    scripts: { test: 'node --test --test-reporter=tap test/*.test.js', start: 'node src/server.js' },
  }, null, 2) + '\n',
  'public/summary.js': summarySource('cancelledCount'),
  'public/index.html': [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Order totals acceptance</title><style>body{font:18px system-ui;max-width:640px;margin:48px auto;padding:20px}button{padding:12px}output{display:block;margin:16px 0}</style></head>',
    '<body><main><h1>Order totals</h1><p>Active items: $10.00 and $2.50. Cancelled item: $5.00.</p>',
    '<button id="calculate" type="button">Calculate total</button><output id="total" aria-label="Order total"></output>',
    '<output id="excluded" aria-label="Cancelled items"></output><p id="message" role="status"></p></main>',
    '<script type="module" src="/app.js"></script></body></html>',
    '',
  ].join('\n'),
  'public/app.js': [
    'import { summarizeOrder } from "./summary.js";',
    'const button = document.querySelector("#calculate");',
    'button.addEventListener("click", async () => {',
    '  button.disabled = true;',
    '  document.querySelector("#message").textContent = "";',
    '  try {',
    '    const response = await fetch("/api/totals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines: [',
    '      { sku: "a", amountCents: 1000, status: "active" }, { sku: "b", amountCents: 500, status: "cancelled" }, { sku: "c", amountCents: 250, status: "active" }',
    '    ] }) });',
    '    if (!response.ok) throw new Error("Calculation failed: HTTP " + response.status);',
    '    const result = summarizeOrder(await response.json());',
    '    document.querySelector("#total").textContent = result.total;',
    '    document.querySelector("#excluded").textContent = result.excluded;',
    '  } catch (error) { document.querySelector("#message").textContent = error.message; }',
    '  finally { button.disabled = false; }',
    '});',
    '',
  ].join('\n'),
  'src/server.js': [
    'import { createServer } from "node:http";',
    'import { readFile } from "node:fs/promises";',
    'import { fileURLToPath } from "node:url";',
    'import { orderTotalsRoute } from "./routes/orderTotalsRoute.js";',
    'const assets = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/summary.js": ["summary.js", "text/javascript"] };',
    'export function createWebsiteServer() {',
    '  return createServer(async (request, response) => {',
    '    const send = (status, body) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };',
    '    if (request.method === "POST" && request.url === "/api/totals") {',
    '      const chunks = []; let size = 0;',
    '      for await (const chunk of request) { size += chunk.length; if (size > 4096) { send(413, { error: "Body too large" }); return; } chunks.push(chunk); }',
    '      let body;',
    '      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }',
    '      catch { send(400, { error: "Invalid JSON" }); return; }',
    '      if (!body || !Array.isArray(body.lines) || !body.lines.every(line => line && typeof line.sku === "string" && Number.isSafeInteger(line.amountCents) && line.amountCents >= 0 && ["active", "cancelled"].includes(line.status))) {',
    '        send(400, { error: "Invalid order lines" }); return;',
    '      }',
    '      send(200, orderTotalsRoute(body)); return;',
    '    }',
    '    const asset = request.method === "GET" && Object.hasOwn(assets, request.url) ? assets[request.url] : undefined;',
    '    if (!asset) { send(404, { error: "Not found" }); return; }',
    '    try {',
    '      const text = await readFile(new URL("../public/" + asset[0], import.meta.url), "utf8");',
    '      response.writeHead(200, { "content-type": asset[1] }); response.end(text);',
    '    } catch (error) { console.error("Website asset failed", error); send(500, { error: "Asset unavailable" }); }',
    '  });',
    '}',
    'if (process.argv[1] === fileURLToPath(import.meta.url)) {',
    '  const server = createWebsiteServer();',
    '  server.listen(0, "127.0.0.1", () => console.log("WEBSITE_URL=http://127.0.0.1:" + server.address().port));',
    '  process.once("SIGTERM", () => server.close());',
    '}',
    '',
  ].join('\n'),
  'test/website.test.js': [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { summarizeOrder } from "../public/summary.js";',
    'import { createWebsiteServer } from "../src/server.js";',
    'async function startSite(t) {',
    '  const server = createWebsiteServer();',
    '  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));',
    '  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));',
    '  return "http://127.0.0.1:" + server.address().port;',
    '}',
    'test("the website renders the excludedLineCount contract", () => {',
    '  assert.deepEqual(summarizeOrder({ totalCents: 1250, excludedLineCount: 1 }), { total: "$12.50", excluded: "1 cancelled item excluded" });',
    '});',
    'test("HTTP totals return the exact contract for mixed, cancelled and empty orders", async t => {',
    '  const base = await startSite(t);',
    '  for (const [lines, total, count] of [',
    '    [[{ sku: "a", amountCents: 1250, status: "active" }, { sku: "b", amountCents: 500, status: "cancelled" }], 1250, 1],',
    '    [[{ sku: "b", amountCents: 500, status: "cancelled" }], 0, 1],',
    '    [[], 0, 0]',
    '  ]) {',
    '    const response = await fetch(base + "/api/totals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lines }) });',
    '    assert.equal(response.status, 200);',
    '    assert.deepEqual(await response.json(), { subtotalCents: total, totalCents: total, excludedLineCount: count });',
    '  }',
    '});',
    'test("HTTP rejects malformed JSON, invalid lines and unknown assets explicitly", async t => {',
    '  const base = await startSite(t);',
    '  for (const body of ["not-json", "{}", JSON.stringify({ lines: [{ sku: "x", amountCents: -1, status: "active" }] }), JSON.stringify({ lines: [{ sku: "x", amountCents: 1, status: "unknown" }] })]) {',
    '    const response = await fetch(base + "/api/totals", { method: "POST", body });',
    '    assert.equal(response.status, 400);',
    '    assert.equal(typeof (await response.json()).error, "string");',
    '  }',
    '  const large = await fetch(base + "/api/totals", { method: "POST", body: "x".repeat(4097) });',
    '  assert.equal(large.status, 413);',
    '  assert.equal((await large.json()).error, "Body too large");',
    '  for (const asset of ["/missing", "/constructor"]) {',
    '    const response = await fetch(base + asset); assert.equal(response.status, 404);',
    '    assert.equal((await response.json()).error, "Not found");',
    '  }',
    '});',
    '',
  ].join('\n'),
};

export function createWebsiteRepo(rootPath = mkdtempSync(join(tmpdir(), 'migrapilot-website-'))): string {
  mkdirSync(rootPath, { recursive: true });
  if (readdirSync(rootPath).length) throw new Error('Website fixture requires an empty directory');
  for (const [relative, content] of Object.entries(WEBSITE_FILES)) {
    const target = join(rootPath, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  candidateGit(rootPath, ['init', '-q']);
  candidateGit(rootPath, ['add', '--all']);
  candidateGit(rootPath, [
    '-c', 'user.name=MigraPilot Acceptance', '-c', 'user.email=acceptance@migrateck.invalid',
    'commit', '-qm', 'Website acceptance baseline\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
  ]);
  return rootPath;
}

export function websiteChangeset(rootPath: string, field: string, fixWebsite = true): ChangesetRequest {
  const files = {
    [REQUIRED_FILES[0]]: `export const ORDER_TOTAL_FIELDS = ["subtotalCents", "totalCents", "${field}"];\n`,
    [REQUIRED_FILES[1]]: [
      'export function computeOrderTotal(lines) {',
      '  const kept = lines.filter(line => line.status !== "cancelled");',
      '  const subtotalCents = kept.reduce((sum, line) => sum + line.amountCents, 0);',
      `  return { subtotalCents, totalCents: subtotalCents, ${field}: lines.length - kept.length };`,
      '}',
      '',
    ].join('\n'),
    [REQUIRED_FILES[2]]: [
      'import { computeOrderTotal } from "../services/orderTotalsService.js";',
      'export function orderTotalsRoute(body) {',
      '  const total = computeOrderTotal(body.lines);',
      `  return { subtotalCents: total.subtotalCents, totalCents: total.totalCents, ${field}: total.${field} };`,
      '}',
      '',
    ].join('\n'),
    'public/summary.js': summarySource(fixWebsite ? field : 'cancelledCount'),
  };
  return { rootPath, ops: Object.entries(files).map(([path, content]) => ({ op: 'replace', path, content })) };
}

export async function buildWebsiteCandidate(rootPath: string, fixWebsite = true) {
  return withDetachedCandidate(rootPath, async (candidateRoot, baseCommit) => {
    const trapBefore = readFileSync(join(candidateRoot, TRAP_FILE), 'utf8');
    const scope = approveEditScope(proposeEditScope({
      runId: 'website-candidate',
      rationale: 'Exclude cancelled totals and expose the count in the website.',
      files: WEBSITE_REQUIRED_FILES.map((path) => {
        const content = readFileSync(join(candidateRoot, path), 'utf8');
        return {
          path, reason: 'Participates in the total, response contract or visible summary.',
          sources: [{ path, startLine: 1, endLine: content.split('\n').length, excerptHash: createHash('sha256').update(content).digest('hex') }],
        };
      }),
    }));
    const report = await runCodingTask({
      runId: 'website-candidate', rootPath: candidateRoot, scope, approvalToken: scope.approvalToken,
      validations: { baseline: WEBSITE_VALIDATION, final: WEBSITE_VALIDATION },
      initialChangeset: websiteChangeset(candidateRoot, 'cancelledCount'),
      repairAuthor: async ({ failureLines }) => failureLines.some((line) => line.includes('excludedLineCount'))
        ? {
            rationale: 'Observed failures require excludedLineCount across the contract and website.',
            citedFailureLines: [...failureLines],
            changeset: websiteChangeset(candidateRoot, 'excludedLineCount', fixWebsite),
          }
        : null,
      maxRepairAttempts: 1,
      requiredPaths: WEBSITE_REQUIRED_FILES,
      applyDeps: { fs: nodeChangesetFs(), store: new ChangesetProposalStore() },
      gitDiffPaths: (root) => candidateGit(root, ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean),
    });
    if (readFileSync(join(candidateRoot, TRAP_FILE), 'utf8') !== trapBefore) {
      throw new Error('Candidate changed the unrelated formatter');
    }
    const changeset: ChangesetRequest = {
      rootPath,
      ops: WEBSITE_REQUIRED_FILES.map((path) => ({ op: 'replace', path, content: readFileSync(join(candidateRoot, path), 'utf8') })),
    };
    candidateGit(candidateRoot, ['add', '--all']);
    return {
      report,
      changeset,
      candidateRoot,
      baseCommit,
      candidateTree: candidateGit(candidateRoot, ['write-tree']),
      diffPaths: candidateGit(candidateRoot, ['diff', '--name-only', 'HEAD']).split('\n').filter(Boolean),
    };
  });
}
