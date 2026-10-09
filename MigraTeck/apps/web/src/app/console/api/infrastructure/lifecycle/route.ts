import { NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";

/**
 * Operator lifecycle actions, proxied to the control authority.
 *
 * The console never holds a Proxmox credential. It authenticates the operator,
 * then asks panel-api on migrapanel-core — which owns the scoped control token,
 * enforces the estate policy, performs the action and independently verifies it.
 *
 * The console's only privileges here are: knowing who the operator is, and being
 * able to ask. Every refusal that matters is decided server-side, so a control
 * this page fails to hide is still refused by the control plane.
 */

export const dynamic = "force-dynamic";

const BASE = () => (process.env.PANEL_API_BASE || "").trim();
const TOKEN = () => (process.env.PANEL_INTERNAL_TOKEN || "").trim();

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "unauthenticated" }, { status: 401 });
  }
  if (!BASE() || !TOKEN()) {
    return NextResponse.json(
      { ok: false, error: "not_configured", message: "This console cannot reach the control authority." },
      { status: 503 },
    );
  }

  let body: { action?: string; vmid?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  try {
    const controller = new AbortController();
    // Longer than the control plane's own verification window, so a verdict
    // arrives here rather than the browser inventing its own timeout.
    const timer = setTimeout(() => controller.abort(), 150_000);
    const res = await fetch(`${BASE()}/internal/infrastructure/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-panel-internal-token": TOKEN() },
      // The operator is asserted by the console session, never by the client.
      body: JSON.stringify({
        action: body.action,
        vmid: body.vmid,
        reason: body.reason ?? "",
        operator: session.email,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({ ok: false, error: "bad_gateway_response" }));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    const name = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.name) : "error";
    // We could not learn the outcome. That is NOT the same as the action failing:
    // it may well have happened. Say exactly that.
    return NextResponse.json(
      {
        ok: false,
        error: "control_authority_unreachable",
        message:
          `The request was sent but the control authority did not answer (${name}). The action may or may not have been applied — re-check the guest's state before retrying.`,
      },
      { status: 504 },
    );
  }
}
