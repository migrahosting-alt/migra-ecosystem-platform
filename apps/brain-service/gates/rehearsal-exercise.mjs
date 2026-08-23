/**
 * Exercise MIGRATED production data through the real Brain API.
 *
 * Reads only. This is someone's actual conversation history — the point is to
 * prove it came back intact and is retrievable, not to write anything new into
 * it. Every assertion is against data that existed in SQLite before the import.
 *
 * `phase1` runs before a restart, `phase2` after. The restart is what separates
 * "the database holds it" from "the process that imported it still remembers".
 */
const BASE = 'http://127.0.0.1:3991';

// The two real tenants in the legacy state, plus the approved index.
const OWNER_A = 'user:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb';
const A_MAIN = { owner: OWNER_A, workspace: `personal:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb` };
const A_ALT = { owner: OWNER_A, workspace: 'personal' };
const OWNER_B = 'user:8c32a204-f0bf-4221-93aa-1571578de00e';
const B = { owner: OWNER_B, workspace: `personal:8c32a204-f0bf-4221-93aa-1571578de00e` };
const APPROVED_INDEX = 'idx_7g3a9o5brg';

const H = (s) => ({
  'content-type': 'application/json',
  'x-owner-scope': s.owner,
  'x-workspace-scope': s.workspace,
});

async function call(method, path, scope, body) {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: H(scope), ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text.slice(0, 300) }; }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
};

async function requireHealthy() {
  const r = await (await fetch(`${BASE}/health`)).json();
  const ready = r?.readiness ?? {};
  process.stdout.write(
    `health: ${r?.status} | persistence: ${ready.persistence} | schema: ${ready.schemaVersion} | state: ${ready.migrationState}\n\n`,
  );
  if (ready.persistence !== 'ready' || ready.migrationState !== 'current') {
    process.stdout.write('ABORT: persistence not ready — any result here would be meaningless.\n');
    process.exit(2);
  }
}

await requireHealthy();
const phase = process.argv[2];

// ── conversations ────────────────────────────────────────────────────────
const listA = await call('GET', '/api/ai/conversations', A_MAIN);
const convsA = listA.body?.conversations ?? [];
check(`${phase}: tenant A's main workspace lists its migrated conversations`,
  listA.status === 200 && convsA.length === 96, `got ${convsA.length}, expected 96`);

const listAAlt = await call('GET', '/api/ai/conversations', A_ALT);
check(`${phase}: tenant A's OTHER workspace is separate`,
  (listAAlt.body?.conversations ?? []).length === 9,
  `got ${(listAAlt.body?.conversations ?? []).length}, expected 9`);

const listB = await call('GET', '/api/ai/conversations', B);
check(`${phase}: tenant B sees only its own`,
  (listB.body?.conversations ?? []).length === 7,
  `got ${(listB.body?.conversations ?? []).length}, expected 7`);

// Cross-tenant: B must not be able to read A's thread even by id.
const aTarget = convsA[0]?.id;
if (aTarget) {
  const stolen = await call('GET', `/api/ai/conversations/${aTarget}`, B);
  check(`${phase}: tenant B cannot open tenant A's conversation by id`,
    stolen.status === 404, `status=${stolen.status}`);
}

// ── messages: real content, in order ─────────────────────────────────────
let withMessages = 0;
let totalMessages = 0;
for (const c of convsA.slice(0, 25)) {
  const msgs = await call('GET', `/api/ai/conversations/${c.id}/messages`, A_MAIN);
  const list = msgs.body?.messages ?? [];
  totalMessages += list.length;
  if (list.length > 0) {
    withMessages += 1;
    const ordered = list.every((m, i) => i === 0 || list[i - 1].createdAt <= m.createdAt);
    if (!ordered) check(`${phase}: message order broken in ${c.id}`, false);
  }
}
check(`${phase}: migrated messages read back with content`,
  totalMessages > 0, `${totalMessages} messages across ${withMessages} of 25 sampled threads`);

// ── grounding: the file set survived on the conversation ─────────────────
let grounded = 0;
for (const c of convsA) {
  if (Array.isArray(c.groundingFiles) && c.groundingFiles.length > 0) grounded += 1;
}
check(`${phase}: conversations still carry their grounding file sets`,
  grounded > 0, `${grounded} of ${convsA.length} threads are grounded`);

// ── retrieval against the APPROVED migrated index ────────────────────────
const status = await call('GET', `/api/ai/indexes/${APPROVED_INDEX}/status`, A_MAIN);
check(`${phase}: the approved index survived the migration`,
  status.body?.state === 'approved' && status.body?.approvedVersion === 29,
  `state=${status.body?.state} approvedVersion=${status.body?.approvedVersion}`);

const retrieved = await call('POST', '/api/ai/retrieve', A_MAIN, {
  query: 'what does the handbook say', indexId: APPROVED_INDEX, requireApproved: true,
});
const chunks = retrieved.body?.chunks ?? [];
check(`${phase}: retrieval from the migrated approved index returns real chunks`,
  retrieved.status === 200 && chunks.length > 0, `status=${retrieved.status} chunks=${chunks.length}`);
check(`${phase}: retrieved chunks carry text and a file path`,
  chunks.length > 0 && chunks.every((c) => typeof c.snippet === 'string' && c.snippet.length > 0 && c.filePath),
  chunks[0] ? `first: ${chunks[0].filePath}` : 'none');

// Logical chunk keys, not legacy storage keys.
const legacyShaped = chunks.filter((c) => typeof c.id === 'string' && c.id.includes(':v'));
check(`${phase}: chunk ids are LOGICAL keys, not legacy storage keys`,
  legacyShaped.length === 0, `${legacyShaped.length} legacy-shaped ids`);

// Tenant B must not retrieve from A's index.
const crossRetrieve = await call('POST', '/api/ai/retrieve', B, {
  query: 'what does the handbook say', indexId: APPROVED_INDEX, requireApproved: true,
});
check(`${phase}: tenant B cannot retrieve from tenant A's index`,
  crossRetrieve.status !== 200 || (crossRetrieve.body?.chunks ?? []).length === 0,
  `status=${crossRetrieve.status} chunks=${(crossRetrieve.body?.chunks ?? []).length}`);

const failed = results.filter((r) => !r).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
