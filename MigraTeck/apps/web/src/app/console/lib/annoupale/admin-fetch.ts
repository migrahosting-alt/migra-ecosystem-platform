import "server-only";
import { getAnnoupaleStaffToken } from "./bridge";

/**
 * Shared SERVER-ONLY admin GET helper for AnnouPale staff endpoints.
 *
 * Gets a per-operator AnnouPale staff token via the bridge, performs a
 * server-side GET against the internal AnnouPale API, and runs a pure contract
 * gate. The token is used only for the Authorization header and is NEVER
 * returned to the caller (so it can never reach client props / the browser).
 *
 * Every new native panel (moderation, audit, analytics) shares this so the
 * token-handling, status mapping, and "never render garbage" contract gate are
 * implemented once. The existing compliance loaders predate this and keep their
 * own inline copy unchanged.
 */

export type AdminFetchReason =
  | "no_session"
  | "missing_env"
  | "denied"
  | "rate_limited"
  | "bridge_unavailable"
  | "upstream_error"
  | "contract_mismatch";

export type AdminFetchResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: AdminFetchReason };

export type ContractParse<T> = (json: unknown) =>
  | { ok: true; data: T }
  | { ok: false };

function mapTokenReason(r: string): AdminFetchReason {
  switch (r) {
    case "no_staff_session":
      return "no_session";
    case "missing_env":
      return "missing_env";
    case "denied":
      return "denied";
    case "rate_limited":
      return "rate_limited";
    case "bridge_unavailable":
      return "bridge_unavailable";
    default:
      return "upstream_error";
  }
}

export async function adminGet<T>(
  path: string,
  parse: ContractParse<T>,
): Promise<AdminFetchResult<T>> {
  const tok = await getAnnoupaleStaffToken();
  if (!tok.ok) return { ok: false, reason: mapTokenReason(tok.reason) };

  const base = process.env.ANNOUPALE_API_BASE_URL;
  if (!base) return { ok: false, reason: "missing_env" };

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/+$/, "")}${path}`, {
      headers: { authorization: `Bearer ${tok.accessToken}` },
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "bridge_unavailable" };
  }

  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "denied" };
  }
  if (res.status === 429) return { ok: false, reason: "rate_limited" };
  // 404 here = endpoint not deployed in this AnnouPale build → treat as unavailable.
  if (res.status === 404) return { ok: false, reason: "bridge_unavailable" };
  if (!res.ok) return { ok: false, reason: "upstream_error" };

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: "contract_mismatch" };
  }

  const parsed = parse(json);
  if (!parsed.ok) {
    return { ok: false, reason: "contract_mismatch" };
  }
  return { ok: true, data: parsed.data };
}

/** Human-facing, non-leaky explanation for a panel fallback. */
export function adminReasonLabel(reason: AdminFetchReason): string {
  switch (reason) {
    case "denied":
      return "Your AnnouPale staff access was not accepted for this surface.";
    case "rate_limited":
      return "Temporarily rate-limited. Try again shortly.";
    case "contract_mismatch":
      return "The service returned an unexpected response.";
    case "no_session":
    case "missing_env":
    case "bridge_unavailable":
    case "upstream_error":
    default:
      return "The native connection is unavailable right now.";
  }
}

/** Build a querystring from defined string/number params only. */
export function buildQuery(
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}
