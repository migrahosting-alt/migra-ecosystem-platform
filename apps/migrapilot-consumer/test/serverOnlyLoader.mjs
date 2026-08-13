/**
 * Resolves the bare specifier `server-only` to an inert stub during tests.
 *
 * Server modules import `server-only` deliberately: it is the build-time
 * guarantee that a client component can never pull them into the browser
 * bundle. That package throws when resolved outside a React Server Component
 * graph, and `node --test` has no such graph — so the boundary would be
 * untestable without this redirect.
 *
 * The stub is never bundled; `next build` resolves the real package.
 */
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') {
    return {
      url: new URL('./serverOnlyStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return next(specifier, context)
}
