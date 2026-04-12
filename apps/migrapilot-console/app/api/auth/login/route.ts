import { NextResponse } from "next/server";

import {
  PORTAL_SESSION_COOKIE,
  portalAuthEnabled,
  portalSessionMaxAgeSeconds,
  portalSessionToken,
  validatePortalCredentials,
} from "@/lib/shared/portal-auth";

export async function POST(request: Request) {
  if (!portalAuthEnabled()) {
    return NextResponse.json({ ok: true, data: { authenticated: true, bypass: true } });
  }

  const body = (await request.json().catch(() => ({}))) as { username?: string; password?: string };
  const username = String(body.username ?? "").trim();
  const password = String(body.password ?? "");

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  if (!validatePortalCredentials(username, password)) {
    return NextResponse.json({ ok: false, error: "INVALID_CREDENTIALS" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, data: { authenticated: true } });
  res.cookies.set(PORTAL_SESSION_COOKIE, portalSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: portalSessionMaxAgeSeconds(),
  });
  return res;
}
