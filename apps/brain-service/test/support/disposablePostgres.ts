/**
 * Disposable PostgreSQL for integration tests.
 *
 * Starts a real PostgreSQL in Docker — not a mock, not an in-memory shim. The
 * concurrency, transaction and locking behaviour this adapter depends on cannot
 * be validated against a fake, which is the whole reason the store is being
 * ported in the first place.
 *
 * Tests SKIP (never silently pass) when Docker is unavailable, and say so.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

const run = promisify(execFile);

const IMAGE = process.env.MIGRAPILOT_TEST_PG_IMAGE ?? 'postgres:16-alpine';
const PASSWORD = 'migrapilot-test';

export interface DisposablePostgres {
  /** Owner/superuser connection — for migrations and fixture setup only. */
  databaseUrl: string;
  stop(): Promise<void>;
}

/**
 * A NON-SUPERUSER connection URL for the same database.
 *
 * Required for any test that asserts row level security. Superusers and
 * BYPASSRLS roles ignore RLS entirely, so asserting isolation on the owner
 * connection proves nothing — it silently passes whatever the policies say.
 *
 * Call AFTER migrations have created the `migrapilot_app` role.
 */
export async function appRoleUrl(ownerUrl: string, password = 'app-test-pw'): Promise<string> {
  const { Client } = await import('pg');
  const login = 'migrapilot_app_test';
  const admin = new Client({ connectionString: ownerUrl });
  await admin.connect();
  try {
    await admin.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${login}') THEN
           CREATE ROLE ${login} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${password}';
         END IF;
       END $$;`,
    );
    // PASSWORD only. NOSUPERUSER/NOBYPASSRLS are superuser-only attributes, and
    // roles are CLUSTER-wide — so on a shared server where this role already
    // exists, re-asserting them fails for the owning role even though CREATE
    // above already set them. Re-asserting a state the role is already in is not
    // worth making the suite undeployable outside a throwaway superuser
    // container.
    await admin.query(`ALTER ROLE ${login} PASSWORD '${password}'`);
    // The unsafe state is still caught, loudly, rather than assumed away.
    const attrs = await admin.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = '${login}'`,
    );
    if (attrs.rows[0]?.rolbypassrls || attrs.rows[0]?.rolsuper) {
      throw new Error(
        `${login} has BYPASSRLS or SUPERUSER; RLS tests would pass vacuously. Fix the role with a superuser.`,
      );
    }
    await admin.query(`GRANT migrapilot_app TO ${login}`);
  } finally {
    await admin.end();
  }

  const url = new URL(ownerUrl);
  url.username = login;
  url.password = password;
  return url.toString();
}

/** Injectable for tests: returns stdout for a command, or throws. */
export type ExecLike = (file: string, args: string[]) => Promise<{ stdout: string }>;

const defaultExec: ExecLike = async (file, args) => run(file, args, { timeout: 15_000 });

/**
 * Report the Docker DAEMON version, or null when no daemon is reachable.
 *
 * Exit codes are useless here. Docker CLI 29.x exits 0 for `info`, `ps` AND
 * `version` even with no daemon at all — an earlier version of this harness
 * used `docker info`'s exit status and consequently reported a client-only
 * install as usable, which silently turned the entire PostgreSQL suite into
 * vacuous skips.
 *
 * `{{.Server.Version}}` is empty unless the daemon actually answered, so it is
 * the only one of the three that distinguishes client from daemon.
 */
export async function dockerDaemonVersion(
  exec: ExecLike = defaultExec,
  binary = 'docker',
): Promise<string | null> {
  try {
    const { stdout } = await exec(binary, ['version', '--format', '{{.Server.Version}}']);
    // `docker.exe` emits CRLF; trimming \r matters or the version never matches.
    const version = stdout.replace(/\r/g, '').trim();
    return version.length > 0 ? version : null;
  } catch {
    return null;
  }
}

/**
 * The docker binary whose daemon actually answers, or null.
 *
 * Prefers a native Linux daemon. Falls back to Docker Desktop's Windows CLI,
 * which WSL can invoke directly — that makes the harness self-provisioning
 * under WSL WITHOUT requiring Docker Desktop's WSL-integration toggle. Ports
 * published by Windows Docker are reachable from WSL on 127.0.0.1.
 */
export async function resolveDockerBinary(exec: ExecLike = defaultExec): Promise<string | null> {
  for (const binary of ['docker', 'docker.exe']) {
    if (await dockerDaemonVersion(exec, binary)) return binary;
  }
  return null;
}

export async function dockerAvailable(exec: ExecLike = defaultExec): Promise<boolean> {
  return (await resolveDockerBinary(exec)) !== null;
}

/** Reason to skip, or null when the environment can host a real PostgreSQL. */
export async function postgresTestSkipReason(): Promise<string | null> {
  if (process.env.MIGRAPILOT_TEST_DATABASE_URL) return null;
  if (await dockerAvailable()) return null;
  return 'no Docker DAEMON reachable (client-only installs do not count) and ' +
    'MIGRAPILOT_TEST_DATABASE_URL unset — a real PostgreSQL is required';
}

/**
 * Start a throwaway PostgreSQL container bound to an ephemeral port.
 *
 * Honours `MIGRAPILOT_TEST_DATABASE_URL` when set, so CI can point at a
 * pre-provisioned instance instead of spawning containers.
 */
/** Containers younger than this are assumed to belong to a running sibling file. */
export const STALE_CONTAINER_AGE_MS = 30 * 60 * 1000;

/**
 * Remove test containers left behind by earlier runs.
 *
 * Best effort by design: a failure to reap must never fail the test that was
 * about to run. The worst case is that the leak persists one more round, which
 * is exactly where we already were.
 */
export async function reapStaleContainers(
  docker: string,
  exec: ExecLike = defaultExec,
  nowMs: number = Date.now(),
): Promise<string[]> {
  const reaped: string[] = [];
  try {
    // `CreatedAt` is emitted like `2026-08-25 14:12:03 -0400 EDT`; the trailing
    // zone abbreviation is not parseable, so it is dropped before parsing.
    const { stdout } = await exec(docker, [
      'ps',
      '-a',
      '--filter',
      'name=migrapilot-pg-test-',
      '--format',
      '{{.Names}}\t{{.CreatedAt}}',
    ]);
    for (const line of stdout.replace(/\r/g, '').split('\n')) {
      const [name, createdAt] = line.split('\t');
      if (!name || !createdAt) continue;
      const parsed = Date.parse(createdAt.replace(/\s+[A-Z]{2,5}$/, ''));
      // An unparseable date is NOT treated as stale: removing a container a
      // sibling file is using would fail that file instead of this leak.
      if (!Number.isFinite(parsed)) continue;
      if (nowMs - parsed < STALE_CONTAINER_AGE_MS) continue;
      await exec(docker, ['rm', '-f', name]).catch(() => undefined);
      reaped.push(name);
    }
  } catch {
    // Best effort: see above.
  }
  return reaped;
}

export async function startDisposablePostgres(): Promise<DisposablePostgres> {
  const preset = process.env.MIGRAPILOT_TEST_DATABASE_URL;
  if (preset) {
    // Carve out a uniquely-named database on the supplied server.
    //
    // Without this, two test FILES sharing one URL migrate and reset the same
    // database concurrently — node's runner executes files in parallel, so they
    // corrupt each other's fixtures. Per-file databases make isolation a
    // property of the harness rather than of runner flags.
    return createScratchDatabase(preset);
  }

  const docker = await resolveDockerBinary();
  if (!docker) throw new Error("no reachable Docker daemon (checked docker and docker.exe)");

  /*
   * REAP BEFORE STARTING.
   *
   * Every container here is removed by its own `stop()` — when the caller
   * remembers to call it and the process lives long enough to run it. A crashed
   * run, a killed suite or a forgotten `after()` leaves one behind FOREVER, and
   * they accumulate: eighteen were found running, some for fourteen hours.
   *
   * That is not a tidiness problem, it is the acceptance gate's determinism.
   * Docker Desktop degrades as they pile up until container starts fail outright
   * with `UtilAcceptVsock: accept4 failed 110`, and a whole block of Postgres
   * tests fails at once — which reads exactly like flaky tests and is not.
   *
   * Reaping on the way IN makes the leak self-healing regardless of how the
   * previous run died. Age-bounded because node's runner executes test files
   * concurrently, and a young container almost certainly belongs to a sibling
   * file that is still using it.
   */
  await reapStaleContainers(docker);

  const name = `migrapilot-pg-test-${randomBytes(4).toString('hex')}`;
  await run(docker, [
    'run', '--rm', '-d',
    '--name', name,
    '-e', `POSTGRES_PASSWORD=${PASSWORD}`,
    '-e', 'POSTGRES_DB=migrapilot_test',
    '-P',
    IMAGE,
  ], { timeout: 120_000 });

  const stop = async () => {
    await run(docker, ['rm', '-f', name], { timeout: 60_000 }).catch(() => undefined);
  };

  try {
    const { stdout } = await run(docker, ['port', name, '5432/tcp'], { timeout: 30_000 });
    const port = stdout.replace(/\r/g, '').trim().split('\n')[0]?.split(':').pop();
    if (!port) throw new Error(`could not determine mapped port for ${name}`);

    const databaseUrl = `postgresql://postgres:${PASSWORD}@127.0.0.1:${port}/migrapilot_test`;
    await waitForReady(docker, name);
    // `pg_isready` runs INSIDE the container, which proves the server is up but
    // says nothing about the published port being usable from here. Under
    // Docker Desktop the WSL→Windows forward becomes connectable slightly later,
    // and connecting too early yields ECONNRESET. Readiness must therefore be
    // measured from where the client actually connects.
    await waitForClientConnectable(databaseUrl);
    return { databaseUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/**
 * Create (and later drop) a throwaway database on an existing server.
 *
 * Uses `pg` directly rather than shelling out, so it works wherever the tests
 * themselves can connect.
 */
async function createScratchDatabase(baseUrl: string): Promise<DisposablePostgres> {
  const { Client } = await import('pg');
  const name = `migrapilot_test_${randomBytes(6).toString('hex')}`;

  const admin = new Client({ connectionString: baseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }

  const scoped = new URL(baseUrl);
  scoped.pathname = `/${name}`;

  return {
    databaseUrl: scoped.toString(),
    stop: async () => {
      const cleanup = new Client({ connectionString: baseUrl });
      try {
        await cleanup.connect();
        // Terminate stragglers so DROP cannot block on a lingering session.
        await cleanup.query(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
          [name],
        );
        await cleanup.query(`DROP DATABASE IF EXISTS ${name}`);
      } catch {
        // A leaked scratch database is noise, not a test failure.
      } finally {
        await cleanup.end().catch(() => undefined);
      }
    },
  };
}

/** Poll a real connection from THIS process until the server answers a query. */
async function waitForClientConnectable(databaseUrl: string): Promise<void> {
  const { Client } = await import('pg');
  const deadline = Date.now() + 90_000;
  let lastError = 'never attempted';

  while (Date.now() < deadline) {
    const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw new Error(`published port never became connectable from this process: ${lastError}`);
}

async function waitForReady(docker: string, container: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = 'not started';
  while (Date.now() < deadline) {
    try {
      await run(docker, ['exec', container, 'pg_isready', '-U', 'postgres'], { timeout: 10_000 });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`PostgreSQL container ${container} never became ready: ${lastError}`);
}
