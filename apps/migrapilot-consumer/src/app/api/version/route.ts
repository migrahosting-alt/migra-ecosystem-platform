import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * GET /api/version — which release is actually serving this request.
 *
 * 🚨 THE FAILURE THIS EXISTS FOR, 2026-09-04. A fix was committed, tested,
 * mutation-proven and pushed; the owner then tested the real product and it
 * returned the pre-fix answer. Production had been serving a build from three
 * days earlier the whole time, and nothing in the validation loop could tell:
 * the harness was truthful and irrelevant, because it never asked what was
 * running.
 *
 * "Tested live" now has to mean "tested live against release X, commit Y". This
 * route is what makes that a fact rather than an assumption, and it answers from
 * the ARTIFACT rather than from configuration:
 *
 *   · `buildId` is Next's own per-build id, read from the `.next` directory this
 *     process is serving. It cannot be set by an environment variable, so it
 *     identifies the bundle rather than someone's intent about the bundle.
 *   · `commit` and `release` come from `.next/RELEASE.json`, written INTO the
 *     artifact at build time by the deploy script — so they travel with it. An
 *     env var would describe the machine, not the code.
 *
 * Deliberately unauthenticated: a deploy has to be able to verify what it just
 * activated, and a check that needs a user session is a check nobody runs. It
 * exposes a build id, a release name and a commit — operational identity, never
 * configuration, paths, or anything about a caller.
 */
export const dynamic = 'force-dynamic'

interface ReleaseStamp {
  commit?: string
  release?: string
  builtAt?: string
}

/** Read a file from the serving artifact, or nothing. Never throws. */
async function fromArtifact(name: string): Promise<string | null> {
  try {
    return (await readFile(join(process.cwd(), '.next', name), 'utf8')).trim()
  } catch {
    return null
  }
}

export async function GET(): Promise<Response> {
  const buildId = await fromArtifact('BUILD_ID')
  const stampRaw = await fromArtifact('RELEASE.json')

  let stamp: ReleaseStamp = {}
  if (stampRaw) {
    try {
      stamp = JSON.parse(stampRaw) as ReleaseStamp
    } catch {
      // A malformed stamp is reported as absent rather than guessed at: a
      // deployment check that accepts junk is not a check.
      stamp = {}
    }
  }

  return Response.json(
    {
      /*
       * `null` where it is genuinely unknown — a development server has no
       * release stamp and should say so, not invent one. A deploy asserts on
       * these values, so an honest null is what makes the assertion meaningful.
       */
      buildId,
      commit: stamp.commit ?? null,
      release: stamp.release ?? null,
      builtAt: stamp.builtAt ?? null,
      /** Distinguishes "no stamp because dev" from "no stamp because bad deploy". */
      stamped: Boolean(stampRaw),
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}
