/**
 * Which release is this process actually running?
 *
 * 🚨 WHY THIS EXISTS. A fix that is committed, tested and pushed is invisible to
 * the person testing the product until the artifact serving them contains it.
 * The consumer learned this expensively: a structured-data fix looked broken in
 * production for three days because production was serving an older build, and
 * nothing in the validation loop asserted that the running artifact corresponded
 * to the source being evaluated.
 *
 * ANSWERED FROM THE ARTIFACT, NEVER FROM CONFIGURATION. The identity is read
 * from a RELEASE.json stamped into the build output at build time and shipped
 * with it. An environment variable would describe the machine, not the code —
 * it survives a failed deploy and would confidently report the release someone
 * intended rather than the one running.
 *
 * `buildId` is a digest of the built output itself, so two builds of the same
 * commit with different bytes are distinguishable. The Brain has no framework-
 * assigned build id the way Next does, and "the commit" alone cannot tell a
 * rebuilt artifact from the one that was actually tested.
 *
 * Honest nulls. An unstamped build reports `stamped: false` with nulls rather
 * than guessing, because a fabricated identity is worse than an absent one —
 * the whole point is that a deploy can be REFUSED on this answer.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ReleaseIdentity {
  commit: string | null;
  release: string | null;
  buildId: string | null;
  builtAt: string | null;
  stamped: boolean;
}

const UNSTAMPED: ReleaseIdentity = {
  commit: null,
  release: null,
  buildId: null,
  builtAt: null,
  stamped: false,
};

/** Where the stamp lives, relative to the compiled module that reads it. */
export function releaseStampPath(moduleUrl: string = import.meta.url): string {
  // dist/src/engine/release/ -> dist/
  return join(dirname(fileURLToPath(moduleUrl)), '..', '..', '..', 'RELEASE.json');
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Read the stamp. Never throws: a version endpoint that 500s during a deploy is
 * indistinguishable from a service that is down, and the deploy needs to tell
 * those apart.
 */
export function readReleaseIdentity(path: string = releaseStampPath()): ReleaseIdentity {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return UNSTAMPED;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return UNSTAMPED;
  }
  if (!parsed || typeof parsed !== 'object') return UNSTAMPED;
  const o = parsed as Record<string, unknown>;
  const identity: ReleaseIdentity = {
    commit: asString(o.commit),
    release: asString(o.release),
    buildId: asString(o.buildId),
    builtAt: asString(o.builtAt),
    stamped: false,
  };
  // Stamped means the three values a deploy asserts on are all present. A
  // partial stamp is treated as unstamped so a half-written file cannot satisfy
  // a check that exists to catch exactly that.
  identity.stamped = Boolean(identity.commit && identity.release && identity.buildId);
  return identity;
}
