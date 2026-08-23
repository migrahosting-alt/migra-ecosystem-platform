/**
 * MigraPilot's own preferences, one document per scope.
 *
 * WHAT IS DELIBERATELY NOT HERE: name, email, avatar, verified state, linked
 * providers, sessions. MigraAuth is canonical for all of it, and a second copy
 * would drift the first time someone changes their name in one place. This
 * stores only what MigraPilot alone knows how to honour.
 *
 * The document is validated by the shared contract on the way IN and merged over
 * current defaults on the way OUT, so a row written by an older build gains new
 * preferences at their defaults rather than surfacing as blank controls.
 */

import type { PoolClient } from 'pg';
import {
  applyPreferencePatch,
  normalizePreferences,
  type UserPreferences,
} from '@migrapilot/shared-types/user-preferences';

export interface PreferencesRow {
  preferences: UserPreferences;
  createdAt: number;
  updatedAt: number;
  /** False when this scope has never saved anything — defaults are being shown. */
  stored: boolean;
}

/**
 * Read, or report the defaults.
 *
 * A scope with no row is NOT an error and does NOT get a row created for it.
 * Opening Settings should not write to the database, and `stored` lets the
 * caller tell "you have never changed anything" from "you chose the defaults".
 */
export async function getPreferences(
  client: PoolClient,
  ownerScope: string,
): Promise<PreferencesRow> {
  const { rows } = await client.query<{
    preferences: unknown;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT preferences, created_at, updated_at FROM user_preferences WHERE owner_scope = $1',
    [ownerScope],
  );

  const row = rows[0];
  if (!row) {
    return {
      preferences: normalizePreferences({}),
      createdAt: 0,
      updatedAt: 0,
      stored: false,
    };
  }

  return {
    preferences: normalizePreferences(row.preferences),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    stored: true,
  };
}

export interface PatchResult {
  preferences: UserPreferences;
  /** Keys whose value actually changed. Empty means the write was a no-op. */
  changed: (keyof UserPreferences)[];
}

/**
 * Apply a partial update, atomically.
 *
 * READ AND WRITE IN ONE TRANSACTION, with the row locked. Two settings tabs
 * saving different preferences would otherwise last-write-wins each other: both
 * read the same document, each merges its own change, and the second overwrites
 * the first's. `FOR UPDATE` makes the second wait and merge onto the first's
 * result — which is what a user changing two things in two places expects.
 */
export async function patchPreferences(
  client: PoolClient,
  input: {
    ownerScope: string;
    workspaceScope: string;
    patch: unknown;
    now: number;
  },
): Promise<PatchResult> {
  const { rows } = await client.query<{ preferences: unknown }>(
    'SELECT preferences FROM user_preferences WHERE owner_scope = $1 FOR UPDATE',
    [input.ownerScope],
  );

  const current = normalizePreferences(rows[0]?.preferences ?? {});
  const { next, changed } = applyPreferencePatch(current, input.patch);

  // Written even when nothing changed, so `updated_at` reflects the last save
  // the user actually made — and so the row exists for the next locked read.
  await client.query(
    `INSERT INTO user_preferences (owner_scope, workspace_scope, preferences, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$4)
     ON CONFLICT (owner_scope) DO UPDATE
       SET preferences = EXCLUDED.preferences,
           workspace_scope = EXCLUDED.workspace_scope,
           updated_at = EXCLUDED.updated_at`,
    [input.ownerScope, input.workspaceScope, JSON.stringify(next), input.now],
  );

  return { preferences: next, changed };
}

/** Record that sensitive preferences changed. Keys only — never values. */
export async function recordPreferenceEvent(
  client: PoolClient,
  input: { id: string; ownerScope: string; changedKeys: readonly string[]; now: number },
): Promise<void> {
  if (input.changedKeys.length === 0) return;
  await client.query(
    `INSERT INTO user_preference_events (id, owner_scope, changed_keys, created_at)
     VALUES ($1,$2,$3,$4)`,
    [input.id, input.ownerScope, input.changedKeys.join(','), input.now],
  );
}

export interface PreferenceEvent {
  id: string;
  changedKeys: string[];
  createdAt: number;
}

export async function listPreferenceEvents(
  client: PoolClient,
  ownerScope: string,
  limit = 20,
): Promise<PreferenceEvent[]> {
  const { rows } = await client.query<{ id: string; changed_keys: string; created_at: string }>(
    `SELECT id, changed_keys, created_at FROM user_preference_events
      WHERE owner_scope = $1 ORDER BY created_at DESC LIMIT $2`,
    [ownerScope, Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((row) => ({
    id: row.id,
    changedKeys: row.changed_keys.split(',').filter(Boolean),
    createdAt: Number(row.created_at),
  }));
}

/**
 * Forget everything MigraPilot stored about this scope's preferences.
 *
 * Used by account deletion. Returns what was removed so the caller can report a
 * real number rather than claiming success over an empty statement.
 */
export async function deletePreferences(
  client: PoolClient,
  ownerScope: string,
): Promise<{ preferences: number; events: number }> {
  const events = await client.query('DELETE FROM user_preference_events WHERE owner_scope = $1', [ownerScope]);
  const prefs = await client.query('DELETE FROM user_preferences WHERE owner_scope = $1', [ownerScope]);
  return { preferences: prefs.rowCount ?? 0, events: events.rowCount ?? 0 };
}
