import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getActiveOrgContext } from "@/lib/auth/session";
import { requireApiSession } from "@/lib/auth/api-auth";
import { requireSameOrigin } from "@/lib/security/csrf";
import { isInternalOrg } from "@/lib/security/internal-org";

export async function requireLaunchProxyContext(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return { ok: false as const, response: csrfFailure };
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return { ok: false as const, response: authResult.response };
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "No active organization." }, { status: 400 }),
    };
  }

  const launchServiceUrl = env.LAUNCH_SERVICE_URL;
  if (!launchServiceUrl) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Launch service is not configured." }, { status: 503 }),
    };
  }

  return {
    ok: true as const,
    session: authResult.session,
    activeOrg,
    launchServiceUrl,
  };
}

export async function proxyLaunchServiceJson(
  request: NextRequest,
  endpoint: string,
  init?: { method?: "GET" | "POST"; body?: unknown; requireClientEligibility?: boolean },
) {
  const context = await requireLaunchProxyContext(request);
  if (!context.ok) {
    return context.response;
  }

  if (init?.requireClientEligibility && !context.activeOrg.org.isMigraHostingClient && !isInternalOrg(context.activeOrg.org)) {
    return NextResponse.json(
      { error: "This launch workflow is currently available to eligible MigraHosting clients." },
      { status: 403 },
    );
  }

  const target = new URL(endpoint, context.launchServiceUrl);
  const idempotencyKey = request.headers.get("Idempotency-Key") || randomUUID();

  const upstream = await fetch(target, {
    method: init?.method || "POST",
    headers: {
      "content-type": "application/json",
      "x-actor-id": context.session.user.id,
      "x-tenant-id": context.activeOrg.orgId,
      "x-request-id": request.headers.get("x-request-id") || randomUUID(),
      "x-correlation-id": request.headers.get("x-correlation-id") || randomUUID(),
      "x-launch-source": "migrapanel",
      "idempotency-key": idempotencyKey,
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    cache: "no-store",
  });

  const payload = await upstream.json().catch(() => null);
  return NextResponse.json(payload, { status: upstream.status });
}
