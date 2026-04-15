import { NextRequest, NextResponse } from "next/server";
import { buildSignupUrl } from "@/lib/auth/migraauth";

export async function GET(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  return NextResponse.redirect(buildSignupUrl({ host, forwardedProto }));
}
