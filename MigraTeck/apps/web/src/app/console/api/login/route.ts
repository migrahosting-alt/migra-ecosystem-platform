import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, issueSession, verifyEmail, verifyPassword } from "../../lib/auth";

export const dynamic = "force-dynamic";

const resolveBaseUrl = (req: NextRequest): string => {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return process.env.APP_BASE_URL || new URL(req.url).origin;
};

export async function POST(req: NextRequest) {
  const base = resolveBaseUrl(req);

  if (!isConfigured()) {
    return NextResponse.redirect(new URL("/console/login?error=noconfig", base));
  }

  const form = await req.formData();
  const email = String(form.get("email") || "");
  const password = String(form.get("password") || "");
  const next = String(form.get("next") || "/console");

  if (!verifyEmail(email) || !verifyPassword(password)) {
    return NextResponse.redirect(new URL("/console/login?error=invalid", base));
  }

  await issueSession(email);

  const safeNext = next.startsWith("/console") ? next : "/console";
  return NextResponse.redirect(new URL(safeNext, base));
}
