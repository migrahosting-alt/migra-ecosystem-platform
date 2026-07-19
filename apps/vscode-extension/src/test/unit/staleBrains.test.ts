// Stale-brain identity check. Proves killStaleBrains recognizes a brain launched
// with a RELATIVE path (`node dist/src/server.js` from the brain-service dir) —
// which has no "brain-service" in argv — via its cwd, so a developer's running
// brain can't silently pollute the E2E gate. Never collateral-kills. © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isBrainService } from '../support/staleBrains.js';

test('isBrainService returns false for a non-brain pid (no collateral kill)', () => {
  // The test runner itself: node, but not a brain-service server.js.
  assert.equal(isBrainService(process.pid), false);
  // A pid that cannot exist.
  assert.equal(isBrainService(2 ** 30), false);
});

test('isBrainService detects a RELATIVELY-launched brain via its cwd', async () => {
  // A dir whose path contains "brain-service" + a trivial server.js that idles.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'x-brain-service-')));
  fs.writeFileSync(path.join(dir, 'server.js'), 'setInterval(() => {}, 1000);\n');
  // Launch as `node server.js` FROM that dir — argv is just "node server.js"
  // (no "brain-service" substring); identity must come from the cwd.
  const child = spawn('node', ['server.js'], { cwd: dir, stdio: 'ignore' });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(child.pid, 'child spawned');
    const argv = fs.readFileSync(`/proc/${child.pid}/cmdline`, 'utf8');
    assert.ok(!argv.includes('brain-service'), 'precondition: argv has no brain-service token');
    assert.equal(isBrainService(child.pid!), true, 'detected via cwd');
  } finally {
    child.kill('SIGKILL');
  }
});
