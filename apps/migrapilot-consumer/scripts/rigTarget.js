/**
 * WHERE A HARNESS IS ALLOWED TO GET ITS TARGET FROM.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS IS AN EVIDENCE-INTEGRITY MODULE, NOT A CONVENIENCE
 *
 * A hardcoded `127.0.0.1:3407` is not untidiness. It reproduces, exactly, the
 * false green this project has already been bitten by: another session's
 * product held the expected port, answered 200 throughout, and browser runs
 * reported success against an application nobody was testing.
 *
 * So the rules here are absolute, and each one closes a way a harness can end
 * up pointed at something it did not mean:
 *
 *   · the target comes from the ENVIRONMENT or from RUN METADATA the launcher
 *     wrote — never from a literal in the source
 *   · there is NO DEFAULT and no fallback. A fallback is a hardcoded target
 *     that only appears when you are least expecting it, which is worse than
 *     one you can see
 *   · nothing is ever DISCOVERED. No port scan, no "try 3407 then 3408", no
 *     asking the OS what is listening. A port answers "who is here", never
 *     "are you mine"
 *   · a missing or unusable target FAILS CLOSED. No evidence is better than
 *     evidence about an unknown system
 * ---------------------------------------------------------------------------
 */

import { readFileSync } from 'node:fs'

/**
 * @typedef {object} RigTarget
 * @property {string} url
 * @property {string} [expectedBuildId] present when it came from run metadata
 * @property {string} source
 */

const bad = (message) => {
  throw new Error(
    `RIG TARGET UNRESOLVED — refusing to run.\n${message}\n` +
      '  A harness that guesses its target produces evidence about an unknown system.\n' +
      '  Set MIGRAPILOT_RIG_URL, or MIGRAPILOT_RIG_METADATA pointing at the run metadata\n' +
      '  the launcher wrote. There is deliberately no default.',
  )
}

/**
 * Resolve the rig under test.
 *
 * Metadata is preferred over a bare URL because it carries the build the
 * launcher actually started — which is what lets identity be CHECKED rather
 * than merely reported back to us by whatever answered.
 */
/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {RigTarget}
 */
export function resolveRigTarget(env = process.env) {
  const metadataPath = env.MIGRAPILOT_RIG_METADATA
  if (metadataPath) {
    let raw
    try {
      raw = JSON.parse(readFileSync(metadataPath, 'utf8'))
    } catch (error) {
      bad(`  MIGRAPILOT_RIG_METADATA=${metadataPath} could not be read: ${error.message}`)
    }
    if (!raw?.url) bad(`  ${metadataPath} carries no "url".`)
    return {
      url: String(raw.url).replace(/\/$/, ''),
      ...(raw.buildId ? { expectedBuildId: String(raw.buildId) } : {}),
      source: `run metadata ${metadataPath}`,
    }
  }

  const url = env.MIGRAPILOT_RIG_URL
  if (!url) {
    bad('  Neither MIGRAPILOT_RIG_METADATA nor MIGRAPILOT_RIG_URL is set.')
  }
  return { url: String(url).replace(/\/$/, ''), source: 'MIGRAPILOT_RIG_URL' }
}

/**
 * RULE 4 — the server's build is not the browser's build.
 *
 * Measured 2026-09-07: `/api/version` reported the fixed build and the served
 * chunk contained the fixed markup — both true — while an open tab still ran
 * the PRE-FIX client and produced a screenshot of the old defect. The rejection
 * that followed was about a build nobody was serving any more.
 *
 * A fresh browser profile cannot hold a stale bundle, so an automated harness
 * sidesteps this by accident. An accident is not a guard: this checks that
 * every `/_next/static/` asset the page actually executed exists in the build
 * on disk, which is the only thing that distinguishes "the server has the fix"
 * from "the code running in front of the user has the fix".
 *
 * @param page      a Playwright page that has ALREADY navigated
 * @param assetRoot the built `.next/static` directory to check against
 */
/**
 * @param {string[]} loadedUrls  every URL the page actually fetched
 * @param {string} assetRoot      the built .next/static directory
 * @param {(p: string) => boolean} existsSync
 */
export function assertClientBuild(loadedUrls, assetRoot, existsSync) {
  const names = [
    ...new Set(
      loadedUrls
        .filter((u) => u.includes('/_next/static/'))
        .map((u) => u.split('/_next/static/')[1].split('?')[0]),
    ),
  ]
  if (names.length === 0) {
    throw new Error(
      'CLIENT BUILD UNVERIFIABLE: the page executed no /_next/static/ assets.\n' +
        '  Either nothing loaded, or this is not the application you think it is.',
    )
  }
  const foreign = names.filter((n) => !existsSync(`${assetRoot}/${n}`))
  if (foreign.length > 0) {
    throw new Error(
      `THE BROWSER IS RUNNING A DIFFERENT BUILD than the one on disk.\n` +
        foreign.slice(0, 5).map((n) => `    ${n}`).join('\n') +
        `\n  ${foreign.length} of ${names.length} assets are not in ${assetRoot}.\n` +
        '  A stale client produces evidence about a build nobody is serving.',
    )
  }
  return { assets: names.length }
}
