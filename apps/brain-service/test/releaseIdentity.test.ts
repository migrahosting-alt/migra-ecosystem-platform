/**
 * The release stamp is what a deploy refuses on, so its failure modes matter
 * more than its happy path.
 *
 * A version endpoint that throws during a deploy is indistinguishable from a
 * service that is down, and a partial stamp that reports `stamped: true` would
 * satisfy the very check written to catch a half-written artifact.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { readReleaseIdentity } from '../src/engine/release/releaseIdentity.js';

function stampFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'release-'));
  const path = join(dir, 'RELEASE.json');
  writeFileSync(path, contents, 'utf8');
  return path;
}

describe('readReleaseIdentity', () => {
  it('reports a complete stamp', () => {
    const path = stampFile(JSON.stringify({
      commit: 'abc123', release: 'brain-0905', buildId: 'sha256:deadbeef',
      builtAt: '2026-09-05T00:00:00Z',
    }));
    const id = readReleaseIdentity(path);
    assert.equal(id.stamped, true);
    assert.equal(id.commit, 'abc123');
    assert.equal(id.release, 'brain-0905');
    assert.equal(id.buildId, 'sha256:deadbeef');
  });

  it('reports unstamped rather than throwing when the file is absent', () => {
    const id = readReleaseIdentity(join(tmpdir(), 'definitely-not-here', 'RELEASE.json'));
    assert.equal(id.stamped, false);
    assert.equal(id.commit, null);
  });

  it('reports unstamped on malformed JSON instead of crashing the endpoint', () => {
    const id = readReleaseIdentity(stampFile('{ this is not json'));
    assert.equal(id.stamped, false);
  });

  it('treats a PARTIAL stamp as unstamped', () => {
    // The case that matters: a half-written file must not satisfy the deploy's
    // identity assertion just because one field happens to be present.
    for (const partial of [
      { commit: 'abc123' },
      { commit: 'abc123', release: 'brain-0905' },
      { release: 'brain-0905', buildId: 'x' },
      { commit: '', release: 'brain-0905', buildId: 'x' },
      { commit: '   ', release: '  ', buildId: '  ' },
    ]) {
      const id = readReleaseIdentity(stampFile(JSON.stringify(partial)));
      assert.equal(id.stamped, false, `wrongly stamped: ${JSON.stringify(partial)}`);
    }
  });

  it('does not accept a non-object payload', () => {
    for (const payload of ['null', '42', '"a string"', '[]']) {
      assert.equal(readReleaseIdentity(stampFile(payload)).stamped, false, payload);
    }
  });

  it('never invents an identity', () => {
    // The endpoint exists so a deploy can be REFUSED on its answer. A guess is
    // worse than an absence.
    const id = readReleaseIdentity(stampFile('{}'));
    assert.deepEqual(
      { ...id },
      { commit: null, release: null, buildId: null, builtAt: null, stamped: false },
    );
  });
});
