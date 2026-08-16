/**
 * Test-time module resolution.
 *
 * Two redirects, both harness concerns that never reach a build:
 *
 * 1. `server-only` resolves to an inert stub. Server modules import it
 *    deliberately — it is the build-time guarantee that a client component can
 *    never pull them into the browser bundle. The real package throws when
 *    resolved outside a React Server Component graph, and `node --test` has no
 *    such graph, so the boundary would otherwise be untestable.
 *
 * 2. `@/…` resolves to `src/…`. The alias is declared in `tsconfig.json` and is
 *    what route handlers import through. Without this, route contracts could
 *    only be tested by rewriting production imports to relative paths — i.e. by
 *    changing the code to suit the test.
 *
 * `next build` resolves both for real.
 */

const SRC = new URL('../src/', import.meta.url)

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') {
    return {
      url: new URL('./serverOnlyStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('@/')) {
    return next(new URL(specifier.slice(2), SRC).href, context)
  }

  return next(specifier, context)
}
