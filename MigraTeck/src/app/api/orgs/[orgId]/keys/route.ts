import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/org-context";
import { createApiKey, listApiKeys } from "@/lib/api-keys";
import { requireSameOrigin } from "@/lib/security/csrf";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z.array(z.string().max(100)).max(50).default([]),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const result = await requireOrgContext(request, context, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const keys = await listApiKeys(result.ctx.orgId);
  return NextResponse.json({ keys });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, context, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : undefined;

  const key = await createApiKey({
    orgId: result.ctx.orgId,
    name: parsed.data.name,
    scopes: parsed.data.scopes,
    expiresAt,
    createdById: result.ctx.userId,
  });

  return NextResponse.json(
    {
      id: key.id,
      name: key.name,
      prefixHint: key.prefixHint,
      rawKey: key.rawKey, // only shown once
      scopes: key.scopes,
      expiresAt: key.expiresAt,
      createdAt: key.createdAt,
    },
    { status: 201 },
  );
}
