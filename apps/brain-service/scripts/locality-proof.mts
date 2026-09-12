/**
 * P0 LOCALITY PROOF — the fixed registry against the REAL Ollama catalog.
 *
 * Not a fixture. This asks the same endpoint the Brain asks, and reports what
 * the router would select for every tier, with the evidence for each model's
 * execution locality: bytes on disk against the parameter count it advertises.
 *
 *   npx tsx scripts/locality-proof.mts [http://host:11434/v1]
 */
import { ModelRegistry, type ModelDescriptor } from '../src/engine/models/modelRegistry.js';
import { selectModel } from '../src/engine/models/capabilityRouter.js';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:11434/v1';

function localityOf(m: ModelDescriptor): string {
  if (m.sizeBytes == null) return 'UNKNOWN';
  if (m.sizeBytes < 1_000_000 && (m.paramCount ?? 0) >= 1) {
    return `REMOTE (${m.sizeBytes} B on disk for ${m.paramCount}B params)`;
  }
  return `ON-DEVICE (${(m.sizeBytes / 1e9).toFixed(1)} GB on disk)`;
}

async function report(allowRemote: boolean) {
  const reg = new ModelRegistry({
    sources: [{ id: 'ollama', baseUrl }],
    ttlMs: 0,
    ...(allowRemote ? { allowRemote: true } : {}),
  });
  const catalog = await reg.list(true);
  console.log(`\n=== allowRemote=${allowRemote} — catalog of ${catalog.length} ===`);
  const remote = catalog.filter((m) => m.hosting === 'remote');
  console.log(`    models classified REMOTE in the catalog: ${remote.length === 0 ? 'none' : remote.map((m) => m.id).join(', ')}`);
  const cloudPresent = catalog.some((m) => /-cloud\b/.test(m.id));
  console.log(`    gpt-oss:120b-cloud eligible: ${cloudPresent ? 'YES' : 'NO'}`);

  for (const tier of ['fast', 'balanced', 'deep'] as const) {
    const d = await selectModel(reg, { tier });
    if (!d) { console.log(`    ${tier.padEnd(9)} -> (no model)`); continue; }
    console.log(
      `    ${tier.padEnd(9)} -> ${d.model.id.padEnd(22)} hosting=${(d.model.hosting ?? '?').padEnd(9)} ${localityOf(d.model)}`,
    );
  }
  // The explicit-override path is the other way a caller could reach one.
  const forced = await selectModel(reg, { model: 'gpt-oss:120b-cloud', tier: 'deep' });
  console.log(`    explicit override "gpt-oss:120b-cloud" -> ${forced ? forced.model.id : 'REFUSED (not in catalog)'}`);
}

await report(false);
await report(true);
console.log('\nUnder a provider declared dataLocality=on-device, only the allowRemote=false');
console.log('column is what the engine serves.');
