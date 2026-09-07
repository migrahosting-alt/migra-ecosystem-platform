/**
 * ASSERT WHICH APPLICATION IS ANSWERING, before trusting a single click.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A 200 IS NOT EVIDENCE YOU REACHED THE APP YOU LAUNCHED.
 *
 * Measured, 2026-09-07: this rig lost its port to another session running a
 * DIFFERENT product. The port kept answering 200. Health checks passed,
 * Playwright loaded a page, screenshots rendered — and browser runs were
 * exercising someone else's application while reporting success.
 *
 * That is the shape of convincing-but-false green evidence, and no amount of
 * care inside the test prevents it. The only defence is to make the rig prove
 * its identity first, and to treat a mismatch as a HARD STOP: evidence from an
 * unidentified rig is not weak evidence, it is evidence about an unknown system.
 * ---------------------------------------------------------------------------
 */

/**
 * @param {string} base  e.g. http://127.0.0.1:3407
 * @param {{ expectCommit?: string, expectBuildId?: string }} [opts]
 * @returns {Promise<{ commit: string, release: string, buildId: string }>}
 */
export async function assertRigIdentity(base, opts = {}) {
  let payload
  try {
    const res = await fetch(`${base}/api/version`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    payload = await res.json()
  } catch (error) {
    throw new Error(
      `RIG IDENTITY UNVERIFIABLE at ${base}: ${error.message}\n` +
        `  Something may be answering on this port that is not MigraPilot.\n` +
        `  Refusing to run — unidentified evidence is worse than none.`,
    )
  }

  /*
   * IDENTITY IS THE VERSION CONTRACT'S SHAPE, not the commit.
   *
   * A local `next build` is legitimately UNSTAMPED — `commit` and `release` are
   * null and `stamped` is false, because stamping happens at deploy. Requiring a
   * commit made the guard refuse every local rig, which is precisely where it is
   * needed: production has a release-identity chain already.
   *
   * `buildId` is Next's own per-build id and is always present, so the pair
   * (buildId is a non-empty string) + (the `stamped` key exists at all) says
   * "this is the MigraPilot consumer" without demanding a deploy artefact. A
   * page title would not — titles are trivially shared between products.
   */
  const looksLikeConsumer =
    payload &&
    typeof payload.buildId === 'string' &&
    payload.buildId.length > 0 &&
    'stamped' in payload
  if (!looksLikeConsumer) {
    throw new Error(
      `RIG IDENTITY UNRECOGNISED at ${base}: ${JSON.stringify(payload).slice(0, 200)}\n` +
        `  This does not look like the MigraPilot consumer. Refusing to run.`,
    )
  }
  /*
   * The build the LAUNCHER recorded, checked against the build ANSWERING. This
   * is what makes run metadata worth more than a bare URL: identity stops being
   * whatever the responder claims and becomes a comparison.
   */
  if (opts.expectBuildId && payload.buildId !== opts.expectBuildId) {
    throw new Error(
      `RIG IS SERVING A DIFFERENT BUILD than the launcher recorded, at ${base}
` +
        `  run metadata says ${opts.expectBuildId}, the rig answers ${payload.buildId}
` +
        '  Something restarted or rebuilt underneath this run. Refusing to collect evidence.',
    )
  }
  if (opts.expectCommit && typeof payload.commit !== 'string') {
    throw new Error(
      `RIG IS UNSTAMPED at ${base}, so commit ${opts.expectCommit} cannot be confirmed.\n` +
        `  Local builds carry no commit. Drop expectCommit for a local rig, or test a deployed one.`,
    )
  }
  if (opts.expectCommit && !payload.commit.startsWith(opts.expectCommit)) {
    throw new Error(
      `RIG IS SERVING THE WRONG BUILD at ${base}\n` +
        `  expected commit ${opts.expectCommit}, got ${payload.commit}\n` +
        `  A rig running stale code produces results about code you did not write.`,
    )
  }
  return payload
}

/*
 * The package is `"type": "module"`, so this file is ESM. A `module.exports`
 * here produced an EMPTY export, and the guard "passed" by not existing — the
 * check silently became a no-op, which is exactly the failure this file exists
 * to prevent. Caught only because the first run printed
 * "assertRigIdentity is not a function" instead of a verdict.
 */
