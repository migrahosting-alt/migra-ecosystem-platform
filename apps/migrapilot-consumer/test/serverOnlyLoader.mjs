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
 * 3. `next/headers` resolves to a real in-memory cookie jar. `cookies()` throws
 *    outside a request scope, and `node --test` has none — so without this the
 *    entire signed-out flow (mint the identity, write it, read it back on the
 *    next request) could only be exercised in production.
 *
 * 4. Static image imports and `next/image` resolve to stubs, so a COMPONENT CAN
 *    BE RENDERED. Node cannot load `.png` bytes, and that single missing loader
 *    is why the chat components had never been rendered in a test: the guard
 *    against runtime state appearing as an answer could only match the source
 *    file as text, and text-matching a source file proves nothing about what a
 *    user sees. It passed while the defect was live on screen.
 *
 * `next build` resolves all of these for real.
 */

const SRC = new URL('../src/', import.meta.url)

/** Extensions `next build` treats as static assets rather than modules. */
const ASSET = /\.(png|jpe?g|gif|svg|webp|avif|ico|woff2?)$/i

export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') {
    return {
      url: new URL('./serverOnlyStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  if (specifier === 'next/headers') {
    return {
      url: new URL('./nextHeadersStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  if (specifier === 'next/image') {
    return {
      url: new URL('./nextImageStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  if (ASSET.test(specifier)) {
    return {
      url: new URL('./staticAssetStub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }

  if (specifier.startsWith('@/')) {
    return next(new URL(specifier.slice(2), SRC).href, context)
  }

  return next(specifier, context)
}
