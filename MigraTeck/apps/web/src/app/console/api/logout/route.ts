import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "../../lib/auth";

export const dynamic = "force-dynamic";

const resolveBaseUrl = (req: NextRequest): string => {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return process.env.APP_BASE_URL || new URL(req.url).origin;
};

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/console/login", resolveBaseUrl(req)));
}

export async function GET(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/console/login", resolveBaseUrl(req)));
}
