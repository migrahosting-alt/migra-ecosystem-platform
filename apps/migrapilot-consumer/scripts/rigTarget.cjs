/**
 * CommonJS bridge to the ESM target resolver, so the browser harnesses can use
 * it too — the same pattern `assert-rig-identity.cjs` uses, and for the same
 * reason: the package is `"type": "module"` and the Playwright harnesses are
 * `.cjs`.
 *
 * 🚨 A `module.exports` in a `.js` file here once produced an EMPTY export and
 * the guard "passed" by not existing. Bridges get their own smoke test in
 * `rigTarget.test.ts` for exactly that reason.
 */
module.exports.resolveRigTarget = async (...args) => {
  const mod = await import('./rigTarget.js')
  return mod.resolveRigTarget(...args)
}

module.exports.assertClientBuild = async (...args) => {
  const mod = await import('./rigTarget.js')
  return mod.assertClientBuild(...args)
}
