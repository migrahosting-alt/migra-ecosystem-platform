/**
 * Server composition root.
 *
 * Auth is NOT installed here. Next runs this hook in its own module graph, so a
 * port installed via `setAuthPort` was invisible to route handlers — every route
 * read a different module instance and answered 503 while the environment was
 * fully configured. The auth port is now resolved lazily in the runtime that
 * serves the request; see `src/server/auth/resolveAuthPort.ts`.
 *
 * This hook remains for future telemetry/bootstrap and must not carry
 * security-critical runtime configuration.
 */

export async function register(): Promise<void> {
  // Auth is NO LONGER installed here.
  //
  // Next runs this hook in its own module graph, so a port installed via
  // `setAuthPort` was invisible to route handlers — every route read a different
  // module instance and answered 503 while the environment was fully configured.
  // The port is now resolved lazily in the runtime that serves the request; see
  // `src/server/auth/resolveAuthPort.ts`. This hook is left for future telemetry
  // and must not carry security-critical configuration.
}
