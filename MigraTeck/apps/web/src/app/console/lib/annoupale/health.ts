import "server-only";

/**
 * SERVER-ONLY loader for AnnouPale platform health (GET /api/health).
 *
 * This endpoint is PUBLIC (no staff token needed) and returns real dependency
 * checks. We report the actual status only — there is NO uptime-percentage
 * field in this endpoint, so we never display a fabricated uptime number.
 */

export type HealthCheck = { name: string; ok: boolean };

export type HealthResult =
  | {
      reachable: true;
      /** "operational" when every dependency check passes; "degraded" otherwise */
      status: "operational" | "degraded";
      checks: HealthCheck[];
      checkedAt: string;
    }
  | { reachable: false };

export async function loadAnnoupaleHealth(): Promise<HealthResult> {
  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { reachable: false };

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}/api/health`, {
      cache: "no-store",
    });
  } catch {
    return { reachable: false };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { reachable: false };
  }

  if (!json || typeof json !== "object") return { reachable: false };
  const body = json as { ok?: unknown; checks?: unknown; timestamp?: unknown };

  const checks: HealthCheck[] = [];
  if (body.checks && typeof body.checks === "object") {
    for (const [name, value] of Object.entries(body.checks as Record<string, unknown>)) {
      checks.push({ name, ok: value === "ok" });
    }
  }

  const allOk = body.ok === true && checks.every((c) => c.ok);
  return {
    reachable: true,
    status: allOk ? "operational" : "degraded",
    checks,
    checkedAt: typeof body.timestamp === "string" ? body.timestamp : "",
  };
}
