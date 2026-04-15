import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/auth/migraauth";

export async function GET(request: NextRequest) {
  const nextPath = request.nextUrl.searchParams.get("next");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const url = await buildAuthorizeUrl({
    host,
    forwardedProto,
    nextPath,
  });

  return NextResponse.redirect(url);
}
