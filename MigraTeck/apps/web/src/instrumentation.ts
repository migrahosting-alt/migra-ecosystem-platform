/**
 * Server startup preflight.
 *
 * Next.js calls register() once, in the Node server runtime, before requests are
 * served. We use it to provision the console administrator's canonical staff
 * identity, so that identity creation is an explicit deployment-time step rather
 * than a side effect of the administrator's first support action.
 *
 * The support actor resolver only ever RESOLVES; it never creates. If this
 * bootstrap has not run, support actions fail closed rather than being attributed
 * to somebody else.
 */
export async function register() {
  // Node runtime only — this touches the database.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { bootstrapEnvironmentAdminIdentity } = await import(
    "./app/console/lib/modules/identity-bootstrap"
  );

  try {
    const result = await bootstrapEnvironmentAdminIdentity();
    switch (result.status) {
      case "created":
        console.info(
          `[console] provisioned canonical staff identity for the environment administrator (${result.email})`,
        );
        break;
      case "exists":
        console.info(`[console] environment administrator identity present (${result.email})`);
        break;
      case "skipped":
        console.warn(
          `[console] environment administrator identity NOT provisioned (${result.reason}). ` +
            `Support actions by that account will be denied rather than misattributed.`,
        );
        break;
    }
  } catch (err) {
    // Do not take the server down: failing closed is the correct outcome. Support
    // actions will be denied, which is safe — the previous behaviour was to
    // silently attribute them to a different employee.
    console.error("[console] environment administrator identity bootstrap failed", err);
  }
}
