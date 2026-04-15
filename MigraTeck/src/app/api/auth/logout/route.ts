import { NextRequest, NextResponse } from "next/server";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { buildCentralLogoutUrl } from "@/lib/auth/migraauth";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";
import { prisma } from "@/lib/prisma";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const sessionToken = SESSION_COOKIE_NAMES.map((name) => request.cookies.get(name)?.value).find(Boolean);
  if (sessionToken) {
    await prisma.session.deleteMany({
      where: { sessionToken },
    });
  }

  const response = NextResponse.json({
    ok: true,
    redirectTo: buildCentralLogoutUrl(),
  });

  for (const cookieName of SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: cookieName.startsWith("__Secure-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }

  response.cookies.set(ACTIVE_ORG_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
