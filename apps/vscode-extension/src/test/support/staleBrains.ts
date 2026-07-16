import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

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
      let cmdline = '';
      try {
        cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      } catch {
        continue; // can't confirm identity → leave it alone
      }
      if (cmdline.includes('brain-service')) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  }
}
