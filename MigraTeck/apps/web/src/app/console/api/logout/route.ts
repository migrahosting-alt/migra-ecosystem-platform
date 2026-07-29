import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "../../lib/auth";

export const dynamic = "force-dynamic";

const resolveBaseUrl = (req: NextRequest): string => {
  const fwdHost = req.headers.get("x-forwarded-host");
  const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
  if (fwdHost) return `${fwdProto}://${fwdHost}`;
  return process.env.APP_BASE_URL || new URL(req.url).origin;
};

// clearSession() expires the cookie at its real Path ("/console"). Next collapses
// multiple Set-Cookie headers that share a name (keeps the last), so we cannot
// emit a second clear for "/" in the same response — and we don't need to: the
// session cookie is only ever set at "/console". One Set-Cookie at "/console" is
// the correct, sufficient clear; the cookies() mutation propagates to the
// redirect response.
async function logout(req: NextRequest): Promise<NextResponse> {
  await clearSession();
  return NextResponse.redirect(
    new URL("/console/login?loggedOut=1", resolveBaseUrl(req)),
  );
}

export async function POST(req: NextRequest) {
  return logout(req);
}

export async function GET(req: NextRequest) {
  return logout(req);
}
