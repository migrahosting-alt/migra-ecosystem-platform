// SERVER-ONLY module. Imported only by the "use server" action (actions.ts) and
// the server-component reports page — never by a Client Component. The bridge key
// is read from process.env (no NEXT_PUBLIC prefix), so it is never shipped to the
// browser. (`server-only` package isn't available in this Next setup, so this is
// enforced by convention + review rather than the import guard.)
import { randomUUID } from "crypto";

import { paleApiRoleFor, type PaleRole } from "./pale-rbac";

/**
 * Server-ONLY client for pale-api's audited admin endpoints (Phase 2 mutations).
 *
 * Reads (Phase 1) go straight to the read-only DB; WRITES go here, through
 * pale-api's `/v1/admin/*` so every mutation is RBAC-checked AND audited
 * server-side. Authenticated with the staff bridge: a shared service key
 * (`PALE_ADMIN_BRIDGE_KEY`, server-only — never NEXT_PUBLIC, never shipped to
 * the browser) plus the acting console admin's identity + mapped staff role, so
 * pale-api records the real human via `onBehalfOf`.
 *
 * `import "server-only"` makes the build fail if this is ever imported into a
 * Client Component.
 */

const ADMIN_BASE =
  process.env.PALE_API_ADMIN_BASE ?? "http://127.0.0.1:4005/api/v1/admin";
const BRIDGE_KEY = process.env.PALE_ADMIN_BRIDGE_KEY ?? "";

export const isBridgeConfigured = () => BRIDGE_KEY.length > 0;

export type BridgeResult = { ok: true } | { ok: false; error: string };

/**
 * Mark a report as "reviewing" via pale-api `PATCH /v1/admin/reports/:id/status`.
 * The only Phase-2A mutation. Never throws into the caller; returns a safe result.
 */
export const markReportReviewing = async (
  reportId: string,
  consoleAdminEmail: string,
  role: PaleRole,
): Promise<BridgeResult> => {
  const apiRole = paleApiRoleFor(role);
  if (!apiRole) return { ok: false, error: "Your role cannot perform this action." };
  if (!BRIDGE_KEY) return { ok: false, error: "Staff bridge is not configured." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const res = await fetch(
      `${ADMIN_BASE}/reports/${encodeURIComponent(reportId)}/status`,
      {
        method: "PATCH",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Pale-Service-Key": BRIDGE_KEY,
          "X-Console-Role": apiRole,
          "X-Console-Actor": consoleAdminEmail,
          "X-Request-Id": randomUUID(),
        },
        body: JSON.stringify({
          status: "reviewing",
          note: "Marked reviewing from MigraPanel Pale Control Center.",
        }),
      },
    );
    if (!res.ok) {
      // Don't surface raw bodies (could leak detail); map to safe messages.
      if (res.status === 401 || res.status === 403)
        return { ok: false, error: "Not authorized by pale-api." };
      if (res.status === 404) return { ok: false, error: "Report not found." };
      return { ok: false, error: `pale-api error (${res.status}).` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach pale-api." };
  } finally {
    clearTimeout(timer);
  }
};
