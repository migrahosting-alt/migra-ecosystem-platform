/**
 * Post-cutover verification against the LIVE production Brain.
 *
 * Writes are confined to ONE conversation this script creates in an internal
 * probe scope. No real tenant's data is mutated — their threads are read only,
 * which is the whole point: prove they came back, do not touch them.
 *
 * `phase1` before the restart, `phase2` after. The restart is what separates
 * "PostgreSQL holds it" from "the process still remembers it".
 */
const BASE = process.env.BRAIN_BASE ?? 'http://127.0.0.1:3988';

const A_MAIN = { owner: 'user:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb', workspace: 'personal:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb' };
const A_ALT = { owner: 'user:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb', workspace: 'personal' };
const B = { owner: 'user:8c32a204-f0bf-4221-93aa-1571578de00e', workspace: 'personal:8c32a204-f0bf-4221-93aa-1571578de00e' };
const PROBE = { owner: 'cutover-probe', workspace: 'cutover-probe' };
const APPROVED_INDEX = 'idx_7g3a9o5brg';
const STATE = '/tmp/cutover-probe-ids';

const H = (s) => ({ 'content-type': 'application/json', 'x-owner-scope': s.owner, 'x-workspace-scope': s.workspace });

async function call(method, path, scope, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H(scope), ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: text.slice(0, 200) }; }
}

const results = [];
const check = (n, ok, d = '') => { results.push(ok); process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}\n`); };

const health = await (await fetch(`${BASE}/health`)).json();
const r = health?.readiness ?? {};
process.stdout.write(`health: ${health?.status} | persistence: ${r.persistence} | schema: ${r.schemaVersion} | state: ${r.migrationState}\n\n`);
if (r.persistence !== 'ready' || r.migrationState !== 'current' || Number(r.schemaVersion) !== 13) {
  process.stdout.write('ABORT: health gate not satisfied.\n');
  process.exit(2);
}

const fs = await import('node:fs');
const phase = process.argv[2];

// ── existing history is present and unchanged ────────────────────────────
const listA = await call('GET', '/api/ai/conversations', A_MAIN);
const convsA = listA.body?.conversations ?? [];
check(`${phase}: existing history present (tenant A main)`, convsA.length === 96, `${convsA.length}, expected 96`);
check(`${phase}: tenant A alt workspace`, (await call('GET', '/api/ai/conversations', A_ALT)).body?.conversations?.length === 9);
check(`${phase}: tenant B`, (await call('GET', '/api/ai/conversations', B)).body?.conversations?.length === 7);

// ── an OLD conversation opens with its messages ──────────────────────────
const oldWithMessages = [];
for (const c of convsA.slice(0, 30)) {
  const m = await call('GET', `/api/ai/conversations/${c.id}/messages`, A_MAIN);
  if ((m.body?.messages ?? []).length > 0) oldWithMessages.push({ id: c.id, n: m.body.messages.length });
}
check(`${phase}: an OLD conversation opens with its migrated messages`,
  oldWithMessages.length > 0, `${oldWithMessages.length} of 30 sampled have messages`);

// ── grounding survived ───────────────────────────────────────────────────
const grounded = convsA.filter((c) => Array.isArray(c.groundingFiles) && c.groundingFiles.length > 0);
check(`${phase}: grounding sets survived`, grounded.length === 14, `${grounded.length}, expected 14`);

// ── approved index still v29, retrieval cites ────────────────────────────
const st = await call('GET', `/api/ai/indexes/${APPROVED_INDEX}/status`, A_MAIN);
check(`${phase}: approved index still version 29`,
  st.body?.state === 'approved' && st.body?.approvedVersion === 29,
  `state=${st.body?.state} v=${st.body?.approvedVersion}`);

const ret = await call('POST', '/api/ai/retrieve', A_MAIN, { query: 'what does the handbook say', indexId: APPROVED_INDEX, requireApproved: true });
const chunks = ret.body?.chunks ?? [];
check(`${phase}: grounded retrieval returns citable chunks`,
  ret.status === 200 && chunks.length > 0 && chunks.every((c) => c.snippet && c.filePath),
  `chunks=${chunks.length}${chunks[0] ? ` first=${chunks[0].filePath}` : ''}`);

// ── tenant isolation ─────────────────────────────────────────────────────
check(`${phase}: tenant B cannot open tenant A's conversation`,
  (await call('GET', `/api/ai/conversations/${convsA[0]?.id}`, B)).status === 404);
const crossRet = await call('POST', '/api/ai/retrieve', B, { query: 'handbook', indexId: APPROVED_INDEX, requireApproved: true });
check(`${phase}: tenant B cannot retrieve from tenant A's index`,
  crossRet.status !== 200 || (crossRet.body?.chunks ?? []).length === 0, `status=${crossRet.status}`);

// ── the legacy cross-owner index leak must be GONE ───────────────────────
const leakProbe = await call('GET', '/api/ai/indexes', { owner: 'prod-postdeploy-probe', workspace: 'default' });
const leaked = (leakProbe.body?.indexes ?? []).filter((i) => i.id === 'idx_31twfee4sn');
check(`${phase}: the legacy cross-owner index leak is CLOSED`, leaked.length === 0,
  `prod-postdeploy-probe sees ${(leakProbe.body?.indexes ?? []).length} indexes, ${leaked.length} belonging to 'local'`);

// ── a NEW write, in an internal probe scope only ─────────────────────────
if (phase === 'phase1') {
  const conv = await call('POST', '/api/ai/conversations', PROBE, { title: 'cutover probe', memoryMode: 'durable' });
  const id = conv.body?.id;
  check('phase1: new conversation created', conv.status === 201 && Boolean(id), `id=${id}`);

  const msg = await call('POST', `/api/ai/conversations/${id}/messages`, PROBE, { role: 'user', content: 'CUTOVER MARKER AMBER LYNX 2026' });
  check('phase1: new turn acknowledged as DURABLE', msg.body?.message?.durable === true);

  const doomed = await call('POST', '/api/ai/conversations', PROBE, { title: 'to be deleted', memoryMode: 'durable' });
  const doomedId = doomed.body?.id;
  const del = await call('DELETE', `/api/ai/conversations/${doomedId}`, PROBE);
  check('phase1: a delete mutation succeeds', del.status === 200 && del.body?.ok === true);

  fs.writeFileSync(STATE, JSON.stringify({ id, doomedId }));

  // Reload within the same process — the user pressing refresh.
  const reread = await call('GET', `/api/ai/conversations/${id}/messages`, PROBE);
  check('phase1: reload preserves the new turn',
    (reread.body?.messages ?? []).some((m) => m.content?.includes('AMBER LYNX 2026')));
}

if (phase === 'phase2') {
  const { id, doomedId } = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const msgs = await call('GET', `/api/ai/conversations/${id}/messages`, PROBE);
  check('phase2: the new turn SURVIVED the restart',
    (msgs.body?.messages ?? []).some((m) => m.content?.includes('AMBER LYNX 2026')));
  const list = await call('GET', '/api/ai/conversations', PROBE);
  const ids = (list.body?.conversations ?? []).map((c) => c.id);
  check('phase2: CONTROL — the probe conversation is still there', ids.includes(id));
  check('phase2: the deleted conversation stayed deleted', !ids.includes(doomedId));
}

const failed = results.filter((x) => !x).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
