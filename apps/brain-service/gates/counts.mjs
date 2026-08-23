/**
 * Capture per-scope counts from a running Brain, through its real API.
 *
 * Recorded before and after the cutover as a sanity signal. It is NOT the
 * acceptance test — exact reconciliation is. Counts can match while contents
 * differ, which is exactly the trap this whole migration has been avoiding.
 */
const BASE = process.env.BRAIN_BASE ?? 'http://127.0.0.1:3988';

const SCOPES = [
  { owner: 'user:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb', workspace: 'personal:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb' },
  { owner: 'user:74e5ee3d-7a75-4372-bc0d-c8e8f75995fb', workspace: 'personal' },
  { owner: 'user:8c32a204-f0bf-4221-93aa-1571578de00e', workspace: 'personal:8c32a204-f0bf-4221-93aa-1571578de00e' },
  { owner: 'local', workspace: 'default' },
  { owner: 'prod-postdeploy-probe', workspace: 'default' },
  { owner: 'user-persist-probe', workspace: 'user-persist-probe' },
];

const H = (s) => ({
  'content-type': 'application/json',
  'x-owner-scope': s.owner,
  'x-workspace-scope': s.workspace,
});

const out = { base: BASE, scopes: [], totals: { conversations: 0, messages: 0, indexes: 0 } };

for (const scope of SCOPES) {
  const convRes = await fetch(`${BASE}/api/ai/conversations`, { headers: H(scope) });
  const convs = (await convRes.json())?.conversations ?? [];
  let messages = 0;
  for (const c of convs) {
    const m = await fetch(`${BASE}/api/ai/conversations/${c.id}/messages`, { headers: H(scope) });
    messages += ((await m.json())?.messages ?? []).length;
  }
  const idxRes = await fetch(`${BASE}/api/ai/indexes`, { headers: H(scope) });
  const indexes = (await idxRes.json())?.indexes ?? [];
  const grounded = convs.filter((c) => Array.isArray(c.groundingFiles) && c.groundingFiles.length > 0).length;

  const row = {
    owner: scope.owner, workspace: scope.workspace,
    conversations: convs.length, messages, indexes: indexes.length, groundedConversations: grounded,
    approvedIndexes: indexes.filter((i) => i.state === 'approved').length,
  };
  out.scopes.push(row);
  out.totals.conversations += row.conversations;
  out.totals.messages += row.messages;
  out.totals.indexes += row.indexes;
  process.stdout.write(
    `${String(row.conversations).padStart(4)} conv  ${String(row.messages).padStart(4)} msg  ` +
    `${row.indexes} idx (${row.approvedIndexes} approved)  ${row.groundedConversations} grounded   ` +
    `${scope.owner} / ${scope.workspace}\n`,
  );
}

process.stdout.write(
  `\nTOTAL: ${out.totals.conversations} conversations, ${out.totals.messages} messages, ${out.totals.indexes} indexes\n`,
);
if (process.argv[2]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
  process.stdout.write(`written to ${process.argv[2]}\n`);
}
