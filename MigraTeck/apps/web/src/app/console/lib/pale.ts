/**
 * Pale module data + live backend health.
 *
 * Pale is the phone-first mobile messaging app of the AnnouPale ecosystem
 * (Android package `com.migrateck.pale`). Its backend, `pale-api` (NestJS),
 * runs on app-core — the SAME host the console SSR runs on — so unlike the
 * AnnouPale tile (whose web app is on unreachable external infra), we CAN do a
 * real, honest health probe here against the local pale-api health endpoint.
 *
 * Everything else shown in the module is a verified fact about Pale's auth and
 * delivery model (phone OTP via Telnyx Verify; one account per number; one
 * active device per number) — never a fabricated count. No panel-DB metric
 * exists for Pale, so the tile reports an honest 0.0% activity.
 */

/** Local pale-api health endpoint. Overridable for non-colocated deploys. */
export const PALE_API_HEALTH_URL =
  process.env.PALE_API_HEALTH_URL ?? "http://127.0.0.1:4005/api/health";

/** Google Play listing for the Pale Android app. */
export const PALE_PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.migrateck.pale";

export type PaleHealth =
  | { status: "live"; uptimeSeconds: number | null; detail: string }
  | { status: "down"; detail: string }
  | { status: "unreachable"; detail: string };

/**
 * Probe pale-api's health endpoint server-side with a short timeout. Returns an
 * honest tri-state: "live" (200 + status ok), "down" (reached but unhealthy),
 * or "unreachable" (timeout / network error — e.g. console not colocated with
 * pale-api). Never throws; never fabricates uptime.
 */
export const getPaleBackendHealth = async (): Promise<PaleHealth> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(PALE_API_HEALTH_URL, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      return { status: "down", detail: `pale-api returned HTTP ${res.status}` };
    }
    const body = (await res.json().catch(() => null)) as
      | { status?: string; service?: string; uptimeSeconds?: number }
      | null;
    if (body?.status && body.status !== "ok") {
      return { status: "down", detail: `pale-api status: ${body.status}` };
    }
    const uptime =
      typeof body?.uptimeSeconds === "number" ? body.uptimeSeconds : null;
    return {
      status: "live",
      uptimeSeconds: uptime,
      detail: "pale-api responding on app-core (127.0.0.1:4005)",
    };
  } catch {
    return {
      status: "unreachable",
      detail: "pale-api not reachable from the console host",
    };
  } finally {
    clearTimeout(timer);
  }
};

/** Human-friendly uptime, e.g. "3d 4h" / "12m". */
export const formatUptime = (seconds: number | null): string => {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
};
