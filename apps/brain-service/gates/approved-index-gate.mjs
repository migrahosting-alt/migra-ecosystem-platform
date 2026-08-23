/**
 * The approved-index sequence, exactly as specified:
 *
 *   create → sync → approve → retrieve+cite → unrelated request → retrieve again
 *   → hydrate another scope → retrieve original again → [restart] → retrieve+cite
 *
 * `phase1` runs everything up to the restart; `phase2` runs after it. Splitting
 * them is the point: only a real process restart proves the approval came back
 * from PostgreSQL rather than from memory.
 */
const BASE = 'http://127.0.0.1:3990';
const A = { owner: 'gate2:alpha', workspace: 'gate2:ws-a' };
const OTHER = { owner: 'gate2:beta', workspace: 'gate2:ws-b' };
const MARKER = 'EMERALD BADGER 517';
const ID_FILE = '/tmp/gate2-index-id';
const CONV_FILE = '/tmp/gate2-conv-ids';

const H = (s) => ({
  'content-type': 'application/json',
  'x-owner-scope': s.owner,
  'x-workspace-scope': s.workspace,
});

async function call(method, path, scope, body) {
  const res = await fetch(`${BASE}${path}`, { method, headers: H(scope), ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; }
  catch { return { status: res.status, body: text.slice(0, 200) }; }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
};

async function retrieveAndCite(label, indexId) {
  const r = await call('POST', '/api/ai/retrieve', A, { query: 'what is the gateCode', indexId, requireApproved: true });
  const chunks = r.body?.chunks ?? [];
  const cites = chunks.some((c) => (c.snippet ?? '').includes(MARKER));
  check(label, r.status === 200 && cites, `status=${r.status} chunks=${chunks.length} cites=${cites}`);
  return cites;
}

const fs = await import('node:fs');
const phase = process.argv[2];

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

if (phase === 'phase1') {
  const created = await call('POST', '/api/ai/indexes', A, { sourceType: 'docs', root: '/opt/migrapilot/gate-docs' });
  const indexId = created.body?.id;
  check('create index', Boolean(indexId), `id=${indexId}`);
  fs.writeFileSync(ID_FILE, indexId ?? '');

  const synced = await call('POST', `/api/ai/indexes/${indexId}/sync`, A, {});
  const stats = synced.body?.index?.stats ?? {};
  check('sync reads the real fixture', synced.body?.ok === true && stats.files === 1 && stats.chunks >= 1,
    `files=${stats.files} chunks=${stats.chunks}`);

  const approved = await call('PATCH', `/api/ai/indexes/${indexId}`, A, { state: 'approved' });
  check('approve sets approvedVersion', approved.body?.state === 'approved' && approved.body?.approvedVersion >= 1,
    `state=${approved.body?.state} approvedVersion=${approved.body?.approvedVersion}`);

  await retrieveAndCite('retrieve + cite immediately after approval', indexId);

  // Request churn in the SAME scope — this is what re-triggered hydrate and
  // discarded the approvedIndex before the guard.
  await call('GET', '/api/ai/conversations', A);
  await call('GET', '/api/ai/indexes', A);
  await call('GET', '/api/ai/workspaces', A);
  await retrieveAndCite('retrieve + cite after unrelated requests in the same scope', indexId);

  // Another tenant hydrates into the same process.
  await call('GET', '/api/ai/indexes', OTHER);
  await call('GET', '/api/ai/conversations', OTHER);
  await retrieveAndCite('retrieve + cite after ANOTHER scope hydrated', indexId);

  const otherSees = await call('GET', '/api/ai/indexes', OTHER);
  check('the other scope sees none of this index',
    !(otherSees.body?.indexes ?? []).some((i) => i.id === indexId),
    `other has ${(otherSees.body?.indexes ?? []).length}`);

  /*
   * DELETE LIFECYCLE — with a control.
   *
   * "The deleted conversation is still gone after a restart" passes vacuously if
   * persistence is dead and EVERYTHING is gone. So two conversations are created:
   * one is deleted, one is not. After the restart the survivor must still be
   * there WITH its message. Only then does the absence of the other mean the
   * database recorded the deletion.
   */
  const keep = await call('POST', '/api/ai/conversations', A, { title: 'control — must survive', memoryMode: 'durable' });
  const doomed = await call('POST', '/api/ai/conversations', A, { title: 'to be deleted', memoryMode: 'durable' });
  const keepId = keep.body?.id;
  const doomedId = doomed.body?.id;
  check('control + doomed conversations created', Boolean(keepId && doomedId), `keep=${keepId} doomed=${doomedId}`);
  fs.writeFileSync(CONV_FILE, JSON.stringify({ keepId, doomedId }));

  const keepMsg = await call('POST', `/api/ai/conversations/${keepId}/messages`, A,
    { role: 'user', content: 'CONTROL MARKER COBALT HERON 904' });
  check('control message is acknowledged as durable', keepMsg.body?.message?.durable === true);
  await call('POST', `/api/ai/conversations/${doomedId}/messages`, A,
    { role: 'user', content: 'DOOMED MARKER RUST FALCON 118' });

  const del = await call('DELETE', `/api/ai/conversations/${doomedId}`, A);
  check('delete conversation returns ok', del.status === 200 && del.body?.ok === true, `status=${del.status}`);

  const afterDelete = await call('GET', '/api/ai/conversations', A);
  const ids = (afterDelete.body?.conversations ?? []).map((c) => c.id);
  check('deleted conversation is gone immediately', !ids.includes(doomedId));
  check('control conversation is untouched', ids.includes(keepId));

  const again = await call('DELETE', `/api/ai/conversations/${doomedId}`, A);
  check('deleting it a SECOND time is refused, not reported as success',
    again.status === 404 && again.body?.ok !== true, `status=${again.status}`);
}

if (phase === 'phase2') {
  const indexId = fs.readFileSync(ID_FILE, 'utf8').trim();

  // FIRST request after restart — this is the one that hydrates from PostgreSQL.
  await retrieveAndCite('FIRST request after restart retrieves + cites', indexId);
  await retrieveAndCite('and again, after the cache is warm', indexId);

  const status = await call('GET', `/api/ai/indexes/${indexId}/status`, A);
  check('approve index -> restart -> STILL APPROVED',
    status.body?.state === 'approved' && status.body?.approvedVersion >= 1,
    `state=${status.body?.state} approvedVersion=${status.body?.approvedVersion}`);

  // ── delete conversation -> restart -> still deleted ──────────────────────
  const { keepId, doomedId } = JSON.parse(fs.readFileSync(CONV_FILE, 'utf8'));
  const list = await call('GET', '/api/ai/conversations', A);
  const ids = (list.body?.conversations ?? []).map((c) => c.id);

  // The control FIRST. If it did not survive, the next assertion means nothing.
  check('CONTROL: the undeleted conversation survived the restart', ids.includes(keepId),
    `${ids.length} conversations in scope`);
  const keepMsgs = await call('GET', `/api/ai/conversations/${keepId}/messages`, A);
  check('CONTROL: its message survived with content intact',
    (keepMsgs.body?.messages ?? []).some((m) => m.content?.includes('COBALT HERON 904')));

  check('delete conversation -> restart -> STILL DELETED', !ids.includes(doomedId));
  const doomedFetch = await call('GET', `/api/ai/conversations/${doomedId}`, A);
  check('and fetching it directly is a 404, not a resurrected record',
    doomedFetch.status === 404, `status=${doomedFetch.status}`);
  const doomedMsgs = await call('GET', `/api/ai/conversations/${doomedId}/messages`, A);
  const resurrected = (doomedMsgs.body?.messages ?? []).some((m) => m.content?.includes('RUST FALCON 118'));
  check('its messages did not come back either', !resurrected);
}

const failed = results.filter((r) => !r).length;
process.stdout.write(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
