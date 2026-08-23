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
  /**
   * The Brain's OWN database. Preferred over DATABASE_URL.
   *
   * `DATABASE_URL` is a generic name that other tooling on the same host sets
   * for its own database — the Console's Prisma stack among them. Pointing the
   * Brain at another application's database would be a silent, catastrophic
   * mis-binding, so the specific name wins and the generic one is only a
   * fallback.
   */
  MIGRAPILOT_BRAIN_DATABASE_URL?: string;
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
  const databaseUrl = normalise(env.MIGRAPILOT_BRAIN_DATABASE_URL) ?? normalise(env.DATABASE_URL);

  /*
   * CONTRADICTION FIRST, before either setting is honoured.
   *
   * `MIGRAPILOT_PERSISTENCE=postgres` says "use PostgreSQL".
   * `MIGRAPILOT_STATE_DB=off`        says "no durable state at all".
   *
   * Both together is not a preference to resolve, it is a mistake to report.
   * Resolving it silently aborted a production cutover: the `off` branch ran
   * first, the engine came up with persistence `off` and `status: ok`, and
   * PostgreSQL was never consulted. A Brain that looks healthy and refuses
   * every durable write is the worst of the available outcomes.
   *
   * To turn SQLite off for PostgreSQL, do not set MIGRAPILOT_STATE_DB at all —
   * or set it EMPTY to clear an inherited value. `off` is the local
   * "no durability" switch and means something else.
   */
  if (requested === 'postgres' && stateDb === 'off') {
    throw new PersistenceConfigError(
      'MIGRAPILOT_PERSISTENCE=postgres and MIGRAPILOT_STATE_DB=off contradict each other: the first selects ' +
        'PostgreSQL, the second disables durable persistence entirely. Refusing to guess. To use PostgreSQL, ' +
        'leave MIGRAPILOT_STATE_DB unset (or set it empty to clear an inherited value).',
    );
  }

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
        'MIGRAPILOT_BRAIN_DATABASE_URL is required in production (MIGRAPILOT_PERSISTENCE=postgres). Refusing to start ' +
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
        'MIGRAPILOT_PERSISTENCE=postgres requires MIGRAPILOT_BRAIN_DATABASE_URL (or DATABASE_URL). Refusing to fall back to SQLite.',
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
