/**
 * Next.js startup hook.
 *
 * Provisioning the console administrator's identity belongs at startup, not
 * mid-request: doing it inside a request would make a support reply's author
 * depend on whoever happened to click first, and would put a write on a read
 * path.
 *
 * Startup must not fail because of it. If the database is unreachable or the
 * identity is ambiguous, the console still serves — support actor resolution
 * simply refuses, which is the correct failure direction. The outcome is logged
 * either way so the state is never silent.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { bootstrapConsoleAdminIdentity } = await import(
      "./app/console/lib/modules/identity-bootstrap"
    );
    const result = await bootstrapConsoleAdminIdentity();
    if (result.ok) {
      console.info(`[identity-bootstrap] console admin ${result.state}: ${result.email}`);
    } else {
      console.warn(`[identity-bootstrap] not established (${result.state}): ${result.reason}`);
    }
  } catch (error) {
    console.warn(
      `[identity-bootstrap] skipped: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}
