/** CommonJS bridge to the ESM guard, so the browser harnesses can use it too. */
module.exports.assertRigIdentity = async (...args) => {
  const mod = await import('./assert-rig-identity.js')
  return mod.assertRigIdentity(...args)
}
