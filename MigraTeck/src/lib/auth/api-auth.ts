import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth/options";
import { verifyAccessToken } from "@/lib/auth/access-token";
import { prisma } from "@/lib/prisma";

export async function requireApiSession() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true as const, session };
}

export async function requireAccessToken(request: Request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Missing bearer token" }, { status: 401 }),
    };
  }

  try {
    const token = match[1];
    if (!token) {
      throw new Error("Missing bearer token");
    }

    const payload = verifyAccessToken(token);
    const membership = await prisma.membership.findFirst({
      where: {
        userId: payload.sub,
        orgId: payload.orgId,
      },
      include: { org: true, user: true },
    });

    if (!membership) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      };
    }

    return {
      ok: true as const,
      auth: {
        userId: payload.sub,
        orgId: payload.orgId,
        role: payload.role,
        email: payload.email,
      },
      membership,
    };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Invalid bearer token" }, { status: 401 }),
    };
  }
}
