/**
 * MigraAI Engine — persistence selection.
 *
 * Which durable adapter backs the engine is an EXPLICIT choice, never inferred.
 * PostgreSQL is the production architecture; the embedded SQLite adapter exists
 * for local, dev and test operation only.
 *
 * The rule that matters: there is NO fallback from PostgreSQL to SQLite. A
 * misconfigured production process refuses to start rather than quietly opening
 * a local database file — because a Brain that silently serves VM-local state
 * is indistinguishable from a healthy one until the data is already diverged.
 *
 * © MigraTeck LLC.
 */

export type PersistenceKind = 'postgres' | 'sqlite' | 'off';

export interface PersistenceSelection {
  kind: PersistenceKind;
  /** Postgres only. Never logged. */
  databaseUrl?: string;
  /** SQLite only. */
  sqlitePath?: string;
  /** Why this selection was made — surfaced in /health, safe to log. */
  reason: string;
}

export class PersistenceConfigError extends Error {
  readonly code = 'PERSISTENCE_CONFIG';
  constructor(message: string) {
    super(message);
    this.name = 'PersistenceConfigError';
  }
}

export interface PersistenceEnv {
  MIGRAPILOT_PERSISTENCE?: string;
  DATABASE_URL?: string;
  MIGRAPILOT_STATE_DB?: string;
  NODE_ENV?: string;
}

/** Production is the strict mode: postgres required, no fallback, no defaults. */
export function isProductionEnv(env: PersistenceEnv): boolean {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

function normalise(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve the durable adapter from the environment.
 *
 * Throws `PersistenceConfigError` rather than degrading, so a bad configuration
 * is a startup failure with a precise message instead of a silent downgrade.
 */
export function resolvePersistence(env: PersistenceEnv, cwd: string): PersistenceSelection {
  const production = isProductionEnv(env);
  const requested = normalise(env.MIGRAPILOT_PERSISTENCE)?.toLowerCase();
  const stateDb = normalise(env.MIGRAPILOT_STATE_DB);
  const databaseUrl = normalise(env.DATABASE_URL);

  // `MIGRAPILOT_STATE_DB=off` remains the explicit "no durable state" switch.
  if (stateDb === 'off') {
    if (production) {
      throw new PersistenceConfigError(
        'MIGRAPILOT_STATE_DB=off is not permitted in production: durable persistence is required.',
      );
    }
    return { kind: 'off', reason: 'MIGRAPILOT_STATE_DB=off (durable persistence explicitly disabled)' };
  }

  if (requested && requested !== 'postgres' && requested !== 'sqlite') {
    throw new PersistenceConfigError(
      `MIGRAPILOT_PERSISTENCE must be 'postgres' or 'sqlite', got '${requested}'.`,
    );
  }

  // ── production ───────────────────────────────────────────────────────────
  if (production) {
    if (requested === 'sqlite') {
      throw new PersistenceConfigError(
        'MIGRAPILOT_PERSISTENCE=sqlite is not permitted in production. SQLite is a local/dev/test adapter; ' +
          'production durable state must be PostgreSQL.',
      );
    }
    if (stateDb) {
      throw new PersistenceConfigError(
        'MIGRAPILOT_STATE_DB is set in production. A local SQLite database must not back production state; ' +
          'unset it and configure DATABASE_URL.',
      );
    }
    if (!databaseUrl) {
      throw new PersistenceConfigError(
        'DATABASE_URL is required in production (MIGRAPILOT_PERSISTENCE=postgres). Refusing to start ' +
          'rather than fall back to a local database.',
      );
    }
    assertPostgresUrl(databaseUrl);
    return {
      kind: 'postgres',
      databaseUrl,
      reason: requested === 'postgres' ? 'production + MIGRAPILOT_PERSISTENCE=postgres' : 'production (postgres implied)',
    };
  }

  // ── non-production ───────────────────────────────────────────────────────
  if (requested === 'postgres') {
    if (!databaseUrl) {
      throw new PersistenceConfigError(
        'MIGRAPILOT_PERSISTENCE=postgres requires DATABASE_URL. Refusing to fall back to SQLite.',
      );
    }
    assertPostgresUrl(databaseUrl);
    return { kind: 'postgres', databaseUrl, reason: 'MIGRAPILOT_PERSISTENCE=postgres' };
  }

  // Default outside production stays SQLite, preserving existing local behaviour.
  const path = stateDb ?? `${cwd.replace(/\/+$/, '')}/migraai-state.db`;
  return {
    kind: 'sqlite',
    sqlitePath: path,
    reason: requested === 'sqlite'
      ? 'MIGRAPILOT_PERSISTENCE=sqlite (local/dev/test adapter)'
      : 'default local/dev/test adapter (no MIGRAPILOT_PERSISTENCE set, NODE_ENV is not production)',
  };
}

function assertPostgresUrl(url: string): void {
  if (!/^postgres(ql)?:\/\//i.test(url)) {
    throw new PersistenceConfigError(
      "DATABASE_URL must be a postgres:// or postgresql:// URL.",
    );
  }
}

/** Redact credentials before a connection string reaches a log or /health. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.username) parsed.username = parsed.username ? '***' : '';
    return parsed.toString();
  } catch {
    return '<unparseable database url>';
  }
}
