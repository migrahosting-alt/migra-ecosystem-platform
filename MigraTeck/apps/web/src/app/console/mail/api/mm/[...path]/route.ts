import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "../../../../lib/api-helpers";
import {
  resolveStaffIdentity,
  mintPanelToken,
  migramailBase,
  isMailModuleConfigured,
} from "../../../../lib/mail-identity";

/**
 * Server-side proxy from the console to the MigraMail backend `/panel` API.
 *
 * Security model: the browser only ever talks to this same-origin route (cookie
 * auth). This handler resolves the acting staff identity, mints a short-lived
 * signed panel-identity token, and forwards the request to MigraMail with that
 * token in the X-Panel-Identity header. The HMAC secret and the mailbox master
 * credential never reach the browser. MigraMail re-enforces every mailbox
 * permission, so this proxy is defence-in-depth, not the sole gate.
 */

export const dynamic = "force-dynamic";

const PASSTHROUGH_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const auth = await requireSession();
  if (!auth.ok) return auth.response;

  if (!isMailModuleConfigured()) {
    return NextResponse.json({ error: "mail_module_not_configured" }, { status: 503 });
  }

  const identity = await resolveStaffIdentity(auth.session.email);
  if (!identity) {
    return NextResponse.json({ error: "no_mail_access" }, { status: 403 });
  }

  if (!PASSTHROUGH_METHODS.has(req.method)) {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }

  const { path } = await ctx.params;
  const subPath = (path || []).map(encodeURIComponent).join("/");
  const search = req.nextUrl.search || "";
  const target = `${migramailBase()}/api/webmail/panel/${subPath}${search}`;

  const token = mintPanelToken(identity);
  const headers: Record<string, string> = { "X-Panel-Identity": token };

  let body: string | undefined;
  if (req.method !== "GET" && req.method !== "DELETE") {
    const text = await req.text();
    if (text) {
      body = text;
      headers["Content-Type"] = req.headers.get("content-type") || "application/json";
    }
  }

  const init: RequestInit = { method: req.method, headers, cache: "no-store" };
  if (body !== undefined) init.body = body;

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    console.error("[console.mail] upstream fetch failed", err);
    return NextResponse.json({ error: "mail_backend_unreachable" }, { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") || "";
  // Binary (attachments) — stream the bytes back with the original headers.
  if (!contentType.includes("application/json")) {
    const buf = await upstream.arrayBuffer();
    const res = new NextResponse(new Uint8Array(buf), { status: upstream.status });
    if (contentType) res.headers.set("Content-Type", contentType);
    const disp = upstream.headers.get("content-disposition");
    if (disp) res.headers.set("Content-Disposition", disp);
    return res;
  }

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
