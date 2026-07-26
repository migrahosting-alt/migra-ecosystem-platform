import { execSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';

// Deterministic stale-brain cleanup for the test harness. A lifecycle host test
// auto-starts a brain on a fixed port; if an Extension Host run is interrupted
// (timeout/kill) before its teardown, that child is reparented to init and
// survives — contaminating the NEXT gate ("brain not running before auto-start").
// Sweeping the test brain ports before and after every run makes each run start
// from a clean slate regardless of how the previous one ended.
//
// ── OWNERSHIP (why this is not just a port sweep) ────────────────────────────
//
// Port 3988 is ALSO the developer's default `migrapilot.brainUrl`. A sweep that
// killed every brain-service on that port destroyed a brain the suite never
// launched — a developer's running service, or one an installed extension owned.
//
// So identity is not sufficient: a process must be provably TEST-OWNED before it
// can be killed. Ownership is proved by an environment marker stamped on every
// brain the harness (or the extension under test) starts during a run. The marker
// lives in `/proc/<pid>/environ`, which is captured at exec, so it survives
// reparenting — unlike a PID file, which can go stale and be reused.
//
// The rule is FAIL CLOSED: if ownership cannot be read and confirmed, the process
// is left running. Sweeping is a convenience; never destroying someone else's
// service is a correctness requirement.

/** Ports the test suites use for spawned brains (3991 = manual, 3992 = lifecycle
 * auto-start). 3988 stays listed because an OLD interrupted run may have orphaned
 * one there — ownership, not the port, decides whether it may be killed. */
export const TEST_BRAIN_PORTS = [3988, 3991, 3992, 3993];

/** Environment marker stamped on every brain a test run launches. Its VALUE is a
 * per-run token (useful in logs); its PRESENCE is what proves ownership, so a
 * brain orphaned by an earlier interrupted run is still sweepable. */
export const TEST_BRAIN_OWNER_ENV = 'MIGRAPILOT_TEST_BRAIN_OWNER';

/** Stamp the current process environment so every brain spawned during this run
 * — by the harness OR by the extension under test, which inherits `process.env`
 * — carries the ownership marker. Returns the token for the harness to forward
 * into `extensionTestsEnv`. */
export function markTestBrainOwnership(token = `test-${process.pid}-${Date.now()}`): string {
  process.env[TEST_BRAIN_OWNER_ENV] = token;
  return token;
}

/** Confirm a PID is a brain-service process before killing it. A brain launched
 * with an ABSOLUTE path has "brain-service" in argv; one launched RELATIVELY
 * (`node dist/src/server.js` run from the brain-service dir — what a developer
 * or a manual test does) does NOT, so we also confirm via the process's cwd. In
 * both cases the match is exact enough to never collateral-kill another service. */
export function isBrainService(pid: number): boolean {
  try {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
    if (cmdline.includes('brain-service')) return true;
    // argv is NUL-separated; a relative launch is one arg that IS (or ends with)
    // `server.js` — confirm the process is the brain via its working directory.
    const args = cmdline.split('\0').filter(Boolean);
    if (args.some((a) => a === 'server.js' || a.endsWith('/server.js') || a.endsWith('\\server.js'))) {
      const cwd = readlinkSync(`/proc/${pid}/cwd`);
      if (cwd.includes('brain-service')) return true;
    }
  } catch {
    /* can't confirm identity → leave it alone */
  }
  return false;
}

/**
 * Prove the test harness launched this process.
 *
 * FAIL CLOSED: any inability to read or parse the environment — a permission
 * error, a non-Linux platform with no `/proc`, an exited PID — returns false, so
 * the process is left alone. A brain we cannot prove we own is, by definition,
 * someone else's.
 */
export function isTestOwnedBrain(pid: number): boolean {
  try {
    const environ = readFileSync(`/proc/${pid}/environ`, 'utf8');
    return environ
      .split('\0')
      .filter(Boolean)
      .some((entry) => entry.startsWith(`${TEST_BRAIN_OWNER_ENV}=`) && entry.length > TEST_BRAIN_OWNER_ENV.length + 1);
  } catch {
    return false;
  }
}

/** A brain may be killed only when it is BOTH a brain-service AND provably
 * test-owned. Exported so the guarantee is directly unit-testable. */
export function mayKillBrain(pid: number): boolean {
  return isBrainService(pid) && isTestOwnedBrain(pid);
}

export interface SweepResult {
  killed: number[];
  /** Brain processes deliberately left running because ownership was unproven. */
  spared: number[];
}

export function killStaleBrains(ports: number[] = TEST_BRAIN_PORTS): SweepResult {
  const result: SweepResult = { killed: [], spared: [] };
  let listing = '';
  try {
    listing = execSync('ss -ltnp 2>/dev/null || true', { encoding: 'utf8' });
  } catch {
    return result; // ss unavailable — nothing we can safely do
  }

  const seen = new Set<number>();
  for (const port of ports) {
    const portRe = new RegExp(`:${port}\\s`);
    for (const line of listing.split('\n')) {
      if (!portRe.test(line)) {
        continue;
      }
      const match = /pid=(\d+)/.exec(line);
      if (!match) {
        continue;
      }
      const pid = Number(match[1]);
      if (seen.has(pid)) continue;
      seen.add(pid);
      if (!isBrainService(pid)) {
        continue; // not a brain at all — never our business
      }
      if (!isTestOwnedBrain(pid)) {
        // A pre-existing developer/extension-owned brain. Leave it running and
        // say so, because silently sparing looks identical to silently killing.
        result.spared.push(pid);
        console.log(`[staleBrains] spared pid ${pid} on :${port} — not launched by this test run`);
        continue;
      }
      try {
        process.kill(pid, 'SIGKILL');
        result.killed.push(pid);
      } catch {
        /* already gone */
      }
    }
  }
  return result;
}
