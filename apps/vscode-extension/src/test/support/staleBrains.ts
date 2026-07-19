import { execSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';

// Deterministic stale-brain cleanup for the test harness. A lifecycle host test
// auto-starts a brain on a fixed port; if an Extension Host run is interrupted
// (timeout/kill) before its teardown, that child is reparented to init and
// survives — contaminating the NEXT gate ("brain not running before auto-start").
// Sweeping the test brain ports before and after every run makes each run start
// from a clean slate regardless of how the previous one ended.
//
// Scoped to brain-service processes only (verified via /proc/<pid>/cmdline) so a
// real service on the same port is never collateral-killed.

/** Ports the test suites use for spawned brains (3991 = manual, 3988 = lifecycle). */
export const TEST_BRAIN_PORTS = [3988, 3991];

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

export function killStaleBrains(ports: number[] = TEST_BRAIN_PORTS): void {
  let listing = '';
  try {
    listing = execSync('ss -ltnp 2>/dev/null || true', { encoding: 'utf8' });
  } catch {
    return; // ss unavailable — nothing we can safely do
  }

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
      if (isBrainService(pid)) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  }
}
