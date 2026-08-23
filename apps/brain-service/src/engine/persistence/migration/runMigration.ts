/**
 * One-shot, resumable legacy import.
 *
 *   legacy Brain state
 *         ↓  read-only extraction
 *   canonical normalized records
 *         ↓  per-scope PostgreSQL import (every write declares its scope)
 *   exact reconciliation
 *
 * Usage:
 *
 *   node dist/src/engine/persistence/migration/runMigration.js \
 *     --source /path/to/copy-of-brain-state.db \
 *     --database-url postgres://... \
 *     --run-id 2026-08-23-rehearsal \
 *     [--verify-only] [--audit-only] [--json report.json]
 *
 * The DSN may also come from MIGRAPILOT_BRAIN_DATABASE_URL so it never has to be
 * typed on a command line that a shell will record.
 *
 * Run it against a COPY of the legacy state. The live file is served by a
 * running Brain, and reading it mid-write imports a torn state.
 */

import { writeFile } from 'node:fs/promises';
import { PostgresConnection } from '../postgres/pool.js';
import { PostgresDurableStore } from '../postgresStore.js';
import { LegacySource } from './legacySource.js';
import { CheckpointStore } from './checkpoint.js';
import { Importer } from './importer.js';
import { reconcile } from './reconcile.js';
import { auditChunkIntegrity } from './chunkAudit.js';

interface Args {
  source: string;
  databaseUrl: string;
  runId: string;
  verifyOnly: boolean;
  auditOnly: boolean;
  json?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const source = get('source');
  const databaseUrl = get('database-url') ?? process.env.MIGRAPILOT_BRAIN_DATABASE_URL ?? process.env.DATABASE_URL;
  const runId = get('run-id');
  if (!source) throw new Error('--source <path to a COPY of the legacy state> is required');
  if (!databaseUrl) throw new Error('--database-url (or MIGRAPILOT_BRAIN_DATABASE_URL) is required');
  if (!runId) throw new Error('--run-id <stable identifier> is required — it is what makes a resume possible');
  return {
    source,
    databaseUrl,
    runId,
    verifyOnly: argv.includes('--verify-only'),
    auditOnly: argv.includes('--audit-only'),
    ...(get('json') === undefined ? {} : { json: get('json')! }),
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const out = (line: string) => process.stdout.write(`${line}\n`);

  const source = new LegacySource(args.source);
  const inventory = source.inventory();
  out(`source:      ${args.source}`);
  out('inventory:   ' + Object.entries(inventory).filter(([, n]) => n > 0)
    .map(([t, n]) => `${t}=${n}`).join(' ') || '(empty)');

  // ── audit runs against the source alone; it needs no target ──────────────
  const audit = await auditChunkIntegrity(source);
  out('');
  out('── historical chunk integrity ──');
  for (const r of audit.indexes) {
    out(`  ${r.indexId}  ${r.verdict}`);
    out(`    scope=${r.ownerScope} / ${r.workspaceScope}`);
    out(`    root=${r.root} (${r.sourceAvailable ? 'source present' : 'SOURCE GONE'})`);
    out(`    files: expected=${r.expectedFiles ?? 'unknown'} persisted=${r.persistedFiles}  chunks=${r.persistedChunks}`);
    if (r.sourceRootIsSymlinked) {
      out(`    NOTE: root resolves through a symlink to ${r.sourceResolvedPath}`);
      out('          The comparison is against the source AS IT IS NOW, not as it was when indexed.');
    }
    if (r.filesMissingFromSource.length) out(`    files persisted but absent from source: ${r.filesMissingFromSource.length}`);
    if (r.filesMissingFromIndex.length) out(`    files in source but not indexed: ${r.filesMissingFromIndex.length}`);
    if (r.duplicateLogicalKeys.length) out(`    DUPLICATE logical keys within a version: ${r.duplicateLogicalKeys.length}`);
    if (r.crossIndexLogicalCollisions.length) out(`    logical keys also used by another index: ${r.crossIndexLogicalCollisions.length}`);
  }
  out(`  → ${audit.unverifiedCount} of ${audit.indexes.length} index(es) could NOT be verified against a source`);
  if (!audit.fullyVerified) {
    out('    Source parity was NOT demonstrated for those. They are migrated as-is and');
    out('    recorded as historical_integrity_unverified. That is the honest state, not a pass.');
  }

  if (args.auditOnly) {
    if (args.json) await writeFile(args.json, JSON.stringify({ inventory, audit }, null, 2));
    source.close();
    return 0;
  }

  const connection = new PostgresConnection({ databaseUrl: args.databaseUrl });
  const store = new PostgresDurableStore(connection);
  await store.initialize();
  const checkpoints = new CheckpointStore(connection);

  let exitCode = 0;
  let totals: Record<string, number> = {};
  try {
    if (!args.verifyOnly) {
      const fingerprint = await LegacySource.fingerprint(args.source);
      const { run, resumed } = await checkpoints.beginOrResume(
        args.runId, args.source, fingerprint, Date.now(),
      );
      out('');
      out(`run:         ${run.runId} (${resumed ? 'RESUMED' : 'new'})`);
      out(`fingerprint: ${fingerprint.slice(0, 32)}…`);
      out('');
      out('── import ──');

      const importer = new Importer({
        source, store, checkpoints, runId: args.runId, now: () => Date.now(),
        onProgress: (p) => {
          const label = `${p.scope.ownerScope} / ${p.scope.workspaceScope}`;
          if (p.skipped) { out(`  skip  ${label}  ${p.stage} (already committed by this run)`); return; }
          const counts = Object.entries(p.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(' ');
          out(`  ok    ${label}  ${p.stage}${counts ? `  ${counts}` : '  (nothing to import)'}`);
        },
      });

      totals = { ...(await importer.importAll()) };
      out(`  totals: ${Object.entries(totals).map(([k, n]) => `${k}=${n}`).join(' ')}`);
    }

    out('');
    out('── exact reconciliation ──');
    const parity = await reconcile(source, store);
    out(`  compared: scopes=${parity.comparedScopes} conversations=${parity.comparedConversations} ` +
      `messages=${parity.comparedMessages} summaries=${parity.comparedSummaries} ` +
      `workspaces=${parity.comparedWorkspaces} indexes=${parity.comparedIndexes} chunks=${parity.comparedChunks}`);

    if (parity.exact) {
      out('  EXACT — every compared field matches');
    } else {
      exitCode = 1;
      out(`  ${parity.mismatches.length} MISMATCH(ES):`);
      for (const m of parity.mismatches.slice(0, 40)) {
        out(`    ${m.domain} ${m.id} [${m.field}] legacy=${JSON.stringify(m.legacy)} postgres=${JSON.stringify(m.postgres)}`);
      }
      if (parity.mismatches.length > 40) out(`    … and ${parity.mismatches.length - 40} more`);
    }

    if (!args.verifyOnly) {
      await checkpoints.finish(
        // The totals are the RECORD of what was imported. Writing `{}` here
        // would erase them from the run row the moment the run finished.
        args.runId, parity.exact ? 'completed' : 'failed', totals,
        parity.exact ? 'exact_parity' : 'parity_mismatch',
        {
          chunkIntegrityFullyVerified: audit.fullyVerified,
          chunkIntegrityUnverifiedIndexes: audit.unverifiedCount,
        },
        Date.now(),
      );
    }

    if (args.json) {
      await writeFile(args.json, JSON.stringify({ inventory, audit, parity }, null, 2));
      out(`\n  report written to ${args.json}`);
    }
  } finally {
    await store.close().catch(() => undefined);
    await connection.close().catch(() => undefined);
    source.close();
  }
  return exitCode;
}

// Only self-execute when run directly, never on import from a test.
if (process.argv[1] && process.argv[1].endsWith('runMigration.js')) {
  main().then((code) => process.exit(code)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(2);
  });
}
