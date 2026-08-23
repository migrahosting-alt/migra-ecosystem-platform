/**
 * Historical chunk-integrity audit.
 *
 * The question this answers: did the legacy chunk key already destroy
 * information before the migration ever ran?
 *
 * The audit is deliberately structured so it can return "unverified" rather than
 * a reassuring number it cannot support. Three of the four production indexes
 * point at upload directories that no longer exist; for those, source parity
 * CANNOT be demonstrated, and saying so is the correct output. An audit that
 * silently reports "0 missing" when it had nothing to compare against is worse
 * than no audit, because it closes the question falsely.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { LegacySource } from './legacySource.js';
import { logicalChunkKey } from './records.js';

export type IntegrityVerdict =
  /** Source present and every persisted chunk maps to a file that still exists. */
  | 'verified_against_source'
  /** Source present, but the persisted chunk set does not match it. */
  | 'source_mismatch'
  /** Source gone. What exists was migrated; parity was never demonstrated. */
  | 'historical_integrity_unverified';

export interface IndexAuditRow {
  indexId: string;
  ownerScope: string;
  workspaceScope: string;
  root: string;
  sourceAvailable: boolean;
  expectedFiles: number | null;
  persistedFiles: number;
  persistedChunks: number;
  /** Files with persisted chunks that no longer exist under the source root. */
  filesMissingFromSource: string[];
  /** Files under the source root with no persisted chunks at the latest version. */
  filesMissingFromIndex: string[];
  /** Logical chunk keys that appear more than once within one index version. */
  duplicateLogicalKeys: string[];
  /**
   * Logical keys that collide ACROSS indexes.
   *
   * Recorded for completeness, NOT as evidence of loss: the legacy row key was
   * `${indexId}:v${version}:${path}#${line}`, so two indexes sharing a logical
   * key still occupied distinct rows. This column exists because the same
   * logical key WAS the whole primary key in the first PostgreSQL port, which is
   * the defect migration 11 removed.
   */
  crossIndexLogicalCollisions: string[];
  verdict: IntegrityVerdict;
}

export interface ChunkAuditReport {
  indexes: IndexAuditRow[];
  /** True only if every index was actually compared against a live source. */
  fullyVerified: boolean;
  unverifiedCount: number;
}

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.next', 'dist-cache']);

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue;
        await walk(join(dir, e.name));
      } else if (e.isFile()) {
        out.push(relative(root, join(dir, e.name)));
      }
    }
  };
  await walk(root);
  return out.sort();
}

export async function auditChunkIntegrity(source: LegacySource): Promise<ChunkAuditReport> {
  const rows: IndexAuditRow[] = [];

  // Logical key -> indexes that hold it, for the cross-index column.
  const logicalOwners = new Map<string, Set<string>>();

  const allScopes = source.scopes();
  const indexRows = allScopes.flatMap((scope) =>
    source.indexes(scope).map((r) => ({ scope, r })));

  for (const { scope, r } of indexRows) {
    const versions = source.chunkVersions(r.id);
    const latest = versions.length > 0 ? versions[versions.length - 1]! : null;
    const chunks = latest === null ? [] : source.chunks(r.id, latest);

    const persistedFiles = new Set(chunks.map((c) => c.file_path));
    const keysSeen = new Set<string>();
    const duplicateLogicalKeys: string[] = [];
    for (const c of chunks) {
      const key = logicalChunkKey(c.file_path, Number(c.start_line));
      if (keysSeen.has(key)) duplicateLogicalKeys.push(key);
      keysSeen.add(key);
      const owners = logicalOwners.get(key) ?? new Set<string>();
      owners.add(r.id);
      logicalOwners.set(key, owners);
    }

    let sourceAvailable = false;
    let sourceFiles: string[] | null = null;
    try {
      const s = await stat(r.root);
      if (s.isDirectory()) {
        sourceFiles = await listFiles(r.root);
        sourceAvailable = true;
      } else if (s.isFile()) {
        sourceFiles = [relative(r.root, r.root)];
        sourceAvailable = true;
      }
    } catch {
      sourceAvailable = false;
    }

    const filesMissingFromSource = sourceAvailable && sourceFiles
      ? [...persistedFiles].filter((f) => !sourceFiles!.includes(f)).sort()
      : [];
    const filesMissingFromIndex = sourceAvailable && sourceFiles
      ? sourceFiles.filter((f) => !persistedFiles.has(f)).sort()
      : [];

    rows.push({
      indexId: r.id,
      ownerScope: scope.ownerScope,
      workspaceScope: scope.workspaceScope,
      root: r.root,
      sourceAvailable,
      expectedFiles: sourceFiles === null ? null : sourceFiles.length,
      persistedFiles: persistedFiles.size,
      persistedChunks: chunks.length,
      filesMissingFromSource,
      filesMissingFromIndex,
      duplicateLogicalKeys,
      crossIndexLogicalCollisions: [],
      verdict: !sourceAvailable
        ? 'historical_integrity_unverified'
        : (filesMissingFromSource.length === 0 && duplicateLogicalKeys.length === 0
          ? 'verified_against_source'
          : 'source_mismatch'),
    });
  }

  // Second pass: fill in cross-index logical collisions now that every index has
  // contributed its keys.
  for (const row of rows) {
    const collisions: string[] = [];
    for (const [key, owners] of logicalOwners) {
      if (owners.size > 1 && owners.has(row.indexId)) collisions.push(key);
    }
    row.crossIndexLogicalCollisions = collisions.sort();
  }

  const unverifiedCount = rows.filter((r) => r.verdict === 'historical_integrity_unverified').length;
  return {
    indexes: rows,
    unverifiedCount,
    // "Fully verified" requires every index to have been compared against a live
    // source. One unverifiable index is enough to make the overall claim false.
    fullyVerified: rows.length > 0 && rows.every((r) => r.verdict === 'verified_against_source'),
  };
}

/** Content hash of a source file, for a caller that wants to re-index and compare. */
export async function hashSourceFile(root: string, relPath: string): Promise<string> {
  const buf = await readFile(join(root, relPath));
  return createHash('sha256').update(buf).digest('hex');
}
