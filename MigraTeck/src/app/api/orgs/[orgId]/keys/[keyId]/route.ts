import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth/org-context";
import { revokeApiKey } from "@/lib/api-keys";
import { requireSameOrigin } from "@/lib/security/csrf";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ orgId: string; keyId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, { params: context.params.then((p) => ({ orgId: p.orgId })) }, {
    minRole: ["OWNER", "ADMIN"],
  });
  if (!result.ok) return result.response;

  const { keyId } = await context.params;
  const revoked = await revokeApiKey(result.ctx.orgId, keyId, result.ctx.userId);

  if (!revoked) {
    return NextResponse.json({ error: "API key not found or already revoked." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
