import "server-only";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Which code am I looking at?
 *
 * This session is the argument for this file. Production was serving a release
 * from a previous day while local work looked finished, and the only way to tell
 * them apart was to fingerprint the build by hand from the server. An operator
 * should never have to infer that.
 *
 * Everything here is derived at runtime from the process itself rather than
 * injected at build time, so it cannot drift from what is actually running:
 *
 *   release  — the release directory `current` resolves to. The service runs with
 *              WorkingDirectory=/opt/migra/apps/migrateck/current/apps/web, so the
 *              real path names the release even though the symlink does not.
 *   build    — .next/BUILD_ID, the same identifier embedded in the asset URLs, so
 *              it can be cross-checked against a page's HTML.
 *   builtAt  — mtime of BUILD_ID, i.e. when this build was produced.
 *
 * Read once per process: none of it changes without a restart.
 */

export interface ReleaseInfo {
  release: string | null;
  build: string | null;
  builtAt: string | null;
}

let cached: ReleaseInfo | null = null;

export const getReleaseInfo = (): ReleaseInfo => {
  if (cached) return cached;

  let release: string | null = null;
  let build: string | null = null;
  let builtAt: string | null = null;

  try {
    const real = realpathSync(process.cwd());
    // .../releases/migrateck/<release>/apps/web  →  <release>
    const m = real.match(/\/releases\/[^/]+\/([^/]+)\//);
    release = m?.[1] ?? real.split("/").filter(Boolean).slice(-3)[0] ?? null;
  } catch {
    release = null;
  }

  try {
    const idPath = join(process.cwd(), ".next", "BUILD_ID");
    build = readFileSync(idPath, "utf8").trim() || null;
    builtAt = statSync(idPath).mtime.toISOString();
  } catch {
    // Absent during `next build` itself, and in dev. Not an error worth failing
    // a page render over — the shell simply shows what it could determine.
    build = null;
    builtAt = null;
  }

  cached = { release, build, builtAt };
  return cached;
};
