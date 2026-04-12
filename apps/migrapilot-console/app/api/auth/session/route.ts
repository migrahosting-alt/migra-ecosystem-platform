import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  PORTAL_SESSION_COOKIE,
  portalAdminUsername,
  portalAuthEnabled,
  portalSessionToken,
} from "@/lib/shared/portal-auth";

export async function GET() {
  if (!portalAuthEnabled()) {
    return NextResponse.json({ ok: true, data: { authenticated: true, username: portalAdminUsername(), bypass: true } });
  }

  const store = await cookies();
  const token = store.get(PORTAL_SESSION_COOKIE)?.value ?? "";
  const authenticated = token === portalSessionToken();
  return NextResponse.json({
    ok: true,
    data: {
      authenticated,
      username: authenticated ? portalAdminUsername() : null,
    },
  });
}
