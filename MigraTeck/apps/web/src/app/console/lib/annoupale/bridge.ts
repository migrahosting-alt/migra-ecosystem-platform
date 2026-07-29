import "server-only";
import { randomUUID } from "node:crypto";
import { getSession } from "../auth";
import {
  resolveBridgeOperatorEmail,
  resolveStaffToken,
  StaffTokenCache,
  type BridgeResult,
} from "./bridge-core";

/**
 * MigraPanel → AnnouPale staff bridge — SERVER-ONLY entrypoint.
 *
 * `import "server-only"` makes any accidental client import a build error, so
 * the AnnouPale access token can never be bundled into client code. The token is
 * returned to the server caller only; it is never written to a cookie,
 * localStorage, a URL, or client props.
 *
 * Identity model (single-admin console): the MigraPanel session is used ONLY to
 * prove the operator is authenticated. The AnnouPale assertion identity comes
 * SOLELY from server env (ANNOUPALE_BRIDGE_OPERATOR_EMAIL, else
 * CONSOLE_ADMIN_EMAIL) — never from the session cookie value or the browser.
 * This decouples the console *login* email from the AnnouPale *operator* email,
 * so the bridge maps to the real trust_safety_admin regardless of which email is
 * used to sign in. AnnouPale still verifies the assertion signature/issuer/
 * audience and enforces its own role checks — this does not weaken any of that.
 *
 * Environment (set on app-core; NEVER committed):
 *   ANNOUPALE_BRIDGE_OPERATOR_EMAIL  the AnnouPale staff (trust_safety_admin)
 *                                    email the console acts as; falls back to
 *                                    CONSOLE_ADMIN_EMAIL if unset
 *   ANNOUPALE_BRIDGE_PRIVATE_KEY     Ed25519 PKCS8 PEM (private signing key)
 *   ANNOUPALE_BRIDGE_KEY_ID          key id (kid header) for rotation
 *   ANNOUPALE_BRIDGE_AUDIENCE        must equal AnnouPale's MIGRATECK_BRIDGE_AUDIENCE
 *   ANNOUPALE_API_BASE_URL           internal AnnouPale API base, e.g.
 *                                    http://127.0.0.1:3100 (no public hairpin)
 */

// Per-process, per-operator cache. Module scope = lives only in server memory.
const cache = new StaffTokenCache();

function readEnv() {
  // PEM values in env files often carry literal "\n" — normalise to real newlines.
  const privateKeyPem = process.env.ANNOUPALE_BRIDGE_PRIVATE_KEY?.replace(
    /\\n/g,
    "\n",
  );
  return {
    privateKeyPem,
    keyId: process.env.ANNOUPALE_BRIDGE_KEY_ID,
    audience: process.env.ANNOUPALE_BRIDGE_AUDIENCE,
    apiBaseUrl: process.env.ANNOUPALE_API_BASE_URL,
  };
}

/**
 * Returns a short-lived AnnouPale staff access token for the configured operator
 * (when the console user is authenticated), or a safe failure reason.
 * Server-side only.
 */
export async function getAnnoupaleStaffToken(): Promise<BridgeResult> {
  const authenticated = Boolean(await getSession());
  const nowSeconds = Math.floor(Date.now() / 1000);

  // Identity is server-authoritative — never the session cookie value/browser.
  const operatorEmail = resolveBridgeOperatorEmail(authenticated, {
    operatorEmail: process.env.ANNOUPALE_BRIDGE_OPERATOR_EMAIL,
    consoleAdminEmail: process.env.CONSOLE_ADMIN_EMAIL,
  });

  if (operatorEmail) {
    const cached = cache.get(operatorEmail, nowSeconds);
    if (cached) return { ok: true, ...cached };
  }

  const result = await resolveStaffToken({
    session: operatorEmail ? { email: operatorEmail } : null,
    env: readEnv(),
    fetchImpl: fetch,
    nowSeconds,
    makeJti: () => randomUUID(),
    // Reason codes only — resolveStaffToken never passes the assertion/token here.
    log: (msg) => console.warn(`[annoupale-bridge] ${msg}`),
  });

  if (result.ok && operatorEmail) {
    cache.set(
      operatorEmail,
      {
        accessToken: result.accessToken,
        expiresAt: result.expiresAt,
        expiresInSeconds: result.expiresInSeconds,
        userId: result.userId,
        email: result.email,
      },
      nowSeconds,
    );
  }

  return result;
}

export type { BridgeResult } from "./bridge-core";
