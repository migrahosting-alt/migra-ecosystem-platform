import { NextResponse } from "next/server";

import { PORTAL_SESSION_COOKIE } from "@/lib/shared/portal-auth";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(PORTAL_SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
