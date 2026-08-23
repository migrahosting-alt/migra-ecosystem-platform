/**
 * Candidate boot/restart durability gate, driven through the candidate Brain's
 * real HTTP API on :3990.
 *
 * `write` seeds every domain under scope A; `read` verifies. Running `read`
 * after a restart is what proves durability — nothing here is in-process, so a
 * pass means the data really came back from PostgreSQL.
 */
const BASE = 'http://127.0.0.1:3990';
const A = { owner: 'gate:alpha', workspace: 'gate:ws-one' };
const B = { owner: 'gate:beta', workspace: 'gate:ws-two' };

const H = (s) => ({
  'content-type': 'application/json',
  'x-owner-scope': s.owner,
  'x-workspace-scope': s.workspace,
});

async function call(method, path, scope, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: H(scope),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 200); }
  return { status: res.status, body: parsed };
}

const CONV = 'gate-conv-1';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
};

/*
 * HEALTH IS A PRECONDITION, NOT AN OBSERVATION.
 *
 * An earlier run of this harness reported 7/7 while `persistence: unavailable` —
 * migration 11 had failed, so every "durable" write lived only in the in-memory
 * index built during sync. The functional assertions were all true and the
 * result was worthless.
 *
 * A persistence-dependent phase therefore ABORTS unless health says persistence
 * is ready. Leaving this to visual inspection is what let a false pass stand.
 */
async function requireHealthyPersistence() {
  let health;
  try {
    const res = await fetch(`${BASE}/health`);
    health = await res.json();
  } catch (error) {
    process.stdout.write(`ABORT: /health unreachable — ${error.message}\n`);
    process.exit(2);
  }
  const r = health?.readiness ?? {};
  const ok = r.persistence === 'ready' && r.migrationState === 'current' && !r.detail;
  process.stdout.write(
    `health: ${health?.status} | persistence: ${r.persistence} | schema: ${r.schemaVersion} | ` +
    `state: ${r.migrationState} | detail: ${r.detail ?? '(none)'}\n`,
  );
  if (!ok) {
    process.stdout.write('ABORT: persistence is not ready — a durability result here would be meaningless.\n');
    process.exit(2);
  }
  if (Number(r.schemaVersion) < 11) {
    process.stdout.write(`ABORT: schema ${r.schemaVersion} is below the required 11.\n`);
    process.exit(2);
  }
  process.stdout.write('precondition ok — persistence is ready\n\n');
}

await requireHealthyPersistence();

const mode = process.argv[2];

if (mode === 'write') {
  const fs = await import('node:fs');
  const conv = await call('POST', '/api/ai/conversations', A, { title: 'gate conversation', memoryMode: 'durable' });
  check('create scoped conversation', conv.status === 201 && Boolean(conv.body?.id), `id=${conv.body?.id}`);
  const id = conv.body?.id;

  const msg = await call('POST', `/api/ai/conversations/${id}/messages`, A, {
    role: 'user', content: 'GATE MARKER SAPPHIRE OTTER 733',
  });
  check('append durable message', msg.status === 200 && msg.body?.message?.durable === true);

  // Record the conversation id for the read phase.
  fs.writeFileSync('/tmp/gate-conv-id', id ?? '');

  const ws = await call('POST', '/api/ai/workspaces', A, { root: '/gate/workspace' });
  check('create workspace', ws.status === 200 || ws.status === 201, `status=${ws.status}`);

  const idx = await call('POST', '/api/ai/indexes', A, { sourceType: 'docs', root: '/gate/workspace' });
  check('create index', idx.status === 200 || idx.status === 201, `status=${idx.status} id=${idx.body?.id}`);
  if (idx.body?.id) fs.writeFileSync('/tmp/gate-index-id', idx.body.id);

  /*
   * Workspace delete lifecycle. `deleteWorkspace` was one of the five writes
   * that crossed the persistence boundary with no scope declared.
   *
   * The control lives in a DIFFERENT scope, because `openWorkspace` is
   * deliberately one-workspace-per-scope: a second POST in the same scope
   * reopens and re-roots the existing record rather than creating a sibling.
   * Putting the control in scope B is the correct shape anyway — it proves the
   * delete removed A's workspace and did not reach across into B's.
   */
  const doomedWs = await call('POST', '/api/ai/workspaces', A, { root: '/gate/doomed-workspace' });
  const keepWs = await call('POST', '/api/ai/workspaces', B, { root: '/gate/control-workspace' });
  const doomedWsId = doomedWs.body?.workspace?.id;
  const keepWsId = keepWs.body?.workspace?.id;
  check('doomed (scope A) + control (scope B) workspaces created',
    Boolean(doomedWsId && keepWsId) && doomedWsId !== keepWsId,
    `doomed=${doomedWsId} control=${keepWsId}`);
  fs.writeFileSync('/tmp/gate-ws-ids', JSON.stringify({ keepWsId, doomedWsId }));

  const crossScope = await call('DELETE', `/api/ai/workspaces/${doomedWsId}`, B);
  check("scope B cannot delete scope A's workspace", crossScope.status === 404,
    `status=${crossScope.status}`);

  const delWs = await call('DELETE', `/api/ai/workspaces/${doomedWsId}`, A);
  check('delete workspace returns ok', delWs.status === 200, `status=${delWs.status}`);

  const wsAfter = await call('GET', '/api/ai/workspaces', A);
  check('deleted workspace is gone immediately from scope A',
    !(wsAfter.body?.workspaces ?? []).map((w) => w.id).includes(doomedWsId));
  const wsAfterB = await call('GET', '/api/ai/workspaces', B);
  check("CONTROL: scope B's workspace is untouched",
    (wsAfterB.body?.workspaces ?? []).map((w) => w.id).includes(keepWsId));
}

if (mode === 'read') {
  const fs = await import('node:fs');
  const id = fs.readFileSync('/tmp/gate-conv-id', 'utf8').trim();

  const list = await call('GET', '/api/ai/conversations', A);
  const found = (list.body?.conversations ?? []).some((c) => c.id === id);
  check('conversation survives', found, `${(list.body?.conversations ?? []).length} in scope A`);

  const msgs = await call('GET', `/api/ai/conversations/${id}/messages`, A);
  const marker = (msgs.body?.messages ?? []).some((m) => m.content?.includes('SAPPHIRE OTTER 733'));
  check('message survives with content intact', marker);

  const durable = (msgs.body?.messages ?? []).every((m) => m.durable === true);
  check('messages still marked durable', durable);

  // Isolation: hydrate B, then re-read A.
  const listB = await call('GET', '/api/ai/conversations', B);
  const bSeesA = (listB.body?.conversations ?? []).some((c) => c.id === id);
  check('scope B cannot see scope A', !bSeesA, `B has ${(listB.body?.conversations ?? []).length}`);

  const listA2 = await call('GET', '/api/ai/conversations', A);
  const stillFound = (listA2.body?.conversations ?? []).some((c) => c.id === id);
  check('scope A intact AFTER B hydrated into the same process', stillFound);

  const wsList = await call('GET', '/api/ai/workspaces', A);
  // Scope A's workspace is deliberately deleted below, so a non-empty list is
  // NOT the assertion here — only that the endpoint answers from a live store.
  check('workspace listing answers after the restart', wsList.status === 200,
    `${(wsList.body?.workspaces ?? []).length} workspaces in scope A`);

  const idxList = await call('GET', '/api/ai/indexes', A);
  check('index survives', idxList.status === 200 && (idxList.body?.indexes ?? []).length > 0,
    `${(idxList.body?.indexes ?? []).length} indexes`);

  const idxListB = await call('GET', '/api/ai/indexes', B);
  /*
   * The invariant is that NONE of A's indexes are visible to B — not that B has
   * none of its own. B legitimately owns an index now: `openWorkspace` creates
   * one per workspace, and B has the control workspace. Asserting `length === 0`
   * measured "B has no workspace yet", which stops being true the moment the
   * test suite gives B anything, and would then fail for the wrong reason.
   */
  const aIds = new Set((idxList.body?.indexes ?? []).map((i) => i.id));
  const bIds = (idxListB.body?.indexes ?? []).map((i) => i.id);
  const leaked = bIds.filter((id) => aIds.has(id));
  check('scope B sees NONE of the indexes belonging to A', leaked.length === 0,
    `A has ${aIds.size}, B has ${bIds.length}, overlap ${leaked.length}`);

  // delete workspace -> restart -> still deleted, with the control first.
  const { keepWsId, doomedWsId } = JSON.parse(fs.readFileSync('/tmp/gate-ws-ids', 'utf8'));
  const wsB = await call('GET', '/api/ai/workspaces', B);
  const wsBIds = (wsB.body?.workspaces ?? []).map((w) => w.id);
  check("CONTROL: scope B's workspace survived the restart", wsBIds.includes(keepWsId),
    `${wsBIds.length} workspaces in scope B`);

  const wsAIds = (wsList.body?.workspaces ?? []).map((w) => w.id);
  check('delete workspace -> restart -> STILL DELETED', !wsAIds.includes(doomedWsId));
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
process.exit(failed.length === 0 ? 0 : 1);
