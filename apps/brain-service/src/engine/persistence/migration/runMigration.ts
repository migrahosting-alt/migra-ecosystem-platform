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

import { chmod, rename, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
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
  probe: boolean;
  snapshot: boolean;
  liveSource?: string;
  out?: string;
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
  const noSourceNeeded = argv.includes('--probe') || argv.includes('--snapshot');
  if (!source && !noSourceNeeded) {
    throw new Error('--source <path to a COPY of the legacy state> is required');
  }
  if (!databaseUrl && !argv.includes('--snapshot')) {
    throw new Error('--database-url (or MIGRAPILOT_BRAIN_DATABASE_URL) is required');
  }
  if (!runId && !noSourceNeeded) {
    throw new Error('--run-id <stable identifier> is required — it is what makes a resume possible');
  }
  return {
    source: source ?? '',
    databaseUrl: databaseUrl ?? '',
    runId: runId ?? 'probe',
    verifyOnly: argv.includes('--verify-only'),
    auditOnly: argv.includes('--audit-only'),
    probe: argv.includes('--probe'),
    snapshot: argv.includes('--snapshot'),
    ...(get('live-source') === undefined ? {} : { liveSource: get('live-source')! }),
    ...(get('out') === undefined ? {} : { out: get('out')! }),
    ...(get('json') === undefined ? {} : { json: get('json')! }),
  };
}

/**
 * Strip credentials out of anything on its way to stdout or a log.
 *
 * The rehearsal reads its DSN from a root-only EnvironmentFile and writes its
 * output to a log a human reads afterwards. A driver that echoes the connection
 * string it tried would put the password in that log and undo the file
 * permissions entirely.
 */
export function redactAnyDsn(text: string): string {
  return text.replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, '$1***$2');
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  const out = (line: string) => process.stdout.write(`${redactAnyDsn(line)}\n`);

  /*
   * SNAPSHOT. Never point the importer at the live file.
   *
   * The live database is served by a running Brain in WAL mode; reading it
   * mid-write imports a torn state. `VACUUM INTO` produces a consistent copy
   * from a READ-ONLY connection, so the artifact being migrated FROM cannot be
   * damaged by the tool that copies it.
   *
   * Run as root, writing straight into the destination, so the copy is never
   * owned by a login user on its way there.
   */
  if (args.snapshot) {
    const live = args.liveSource ?? '/var/lib/migrapilot/brain-state.db';
    const dest = args.out;
    if (!dest) throw new Error('--snapshot requires --out <destination path>');

    const { createHash: hash } = await import('node:crypto');
    const { createReadStream: read } = await import('node:fs');
    const checksum = async (p: string): Promise<string> => {
      const h = hash('sha256');
      const s = read(p);
      s.on('data', (c) => h.update(c));
      await once(s, 'end');
      return h.digest('hex');
    };

    out('── snapshot ──');
    const before = await checksum(live);
    out(`  live source: ${live}`);
    out(`  sha256 before: ${before}`);

    /*
     * Write to a temp path, then rename.
     *
     * `VACUUM INTO` refuses an existing destination, so a re-run needs the path
     * to be clear — but deleting the destination first means a failure partway
     * through leaves NO snapshot, having destroyed the previous one. The real
     * path only ever holds a complete file, and the step stays repeatable.
     */
    const tmp = `${dest}.partial`;
    await rm(tmp, { force: true });

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(live, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    /*
     * VACUUM INTO inherits the process umask, which produced a world-readable
     * 0644 file holding real user conversations. The mode is set here rather
     * than left to whoever launched the process.
     */
    await chmod(tmp, 0o600);
    await rename(tmp, dest);

    const after = await checksum(live);
    out(`  sha256 after:  ${after}`);
    if (before !== after) {
      out('  FAILED: the live database CHANGED while being snapshotted.');
      out('  Either a write landed mid-copy, or this tool is not as read-only as it claims.');
      out('  Do not migrate from this snapshot.');
      return 4;
    }
    out('  live database unchanged — the snapshot did not touch it');
    const mode = (await stat(dest)).mode & 0o777;
    out(`  snapshot:      ${dest}`);
    out(`  mode:          ${mode.toString(8).padStart(4, '0')}${mode === 0o600 ? '' : '  ← EXPECTED 0600'}`);
    out(`  fingerprint:   ${await LegacySource.fingerprint(dest)}`);
    return 0;
  }

  /*
   * PROBE. Connectivity first, pg_hba second.
   *
   * The Brain's own database already authenticates from this host, so the
   * rehearsal database has a good chance of being covered by the existing rules.
   * Editing pg_hba.conf before finding out would be changing production
   * authentication to fix a problem that may not exist.
   */
  if (args.probe) {
    const probeConnection = new PostgresConnection({ databaseUrl: args.databaseUrl });
    try {
      const rows = await probeConnection.query<{
        version: string; db: string; role: string; ssl: boolean | null;
      }>(`SELECT version() AS version, current_database() AS db, current_user AS role,
                 (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`);
      const r = rows[0];
      out('── connectivity probe ──');
      out(`  reachable:  yes`);
      out(`  database:   ${r?.db}`);
      out(`  role:       ${r?.role}`);
      out(`  tls:        ${r?.ssl === null ? 'unknown' : String(r?.ssl)}`);
      out(`  server:     ${(r?.version ?? '').split(',')[0]}`);
      out('  → no pg_hba change needed.');
      return 0;
    } catch (error) {
      out('── connectivity probe ──');
      out('  reachable:  NO');
      out(`  error:      ${redactAnyDsn(error instanceof Error ? error.message : String(error))}`);
      out('  → if this is a pg_hba rejection, add the two narrow rules and reload PostgreSQL.');
      return 3;
    } finally {
      await probeConnection.close().catch(() => undefined);
    }
  }

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
    process.stderr.write(`${redactAnyDsn(error instanceof Error ? error.stack ?? error.message : String(error))}\n`);
    process.exit(2);
  });
}
