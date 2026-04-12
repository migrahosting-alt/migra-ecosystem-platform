import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/org-context";
import { createCheckoutSession } from "@/lib/billing/plans";
import { requireSameOrigin } from "@/lib/security/csrf";

const schema = z.object({
  planSlug: z.string().min(1).max(100),
  successUrl: z.string().url().max(2000),
  cancelUrl: z.string().url().max(2000),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) return csrfFailure;

  const result = await requireOrgContext(request, context, {
    minRole: ["OWNER", "ADMIN", "BILLING"],
  });
  if (!result.ok) return result.response;

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  try {
    const session = await createCheckoutSession({
      orgId: result.ctx.orgId,
      planSlug: parsed.data.planSlug,
      successUrl: parsed.data.successUrl,
      cancelUrl: parsed.data.cancelUrl,
      customerEmail: result.ctx.email,
    });

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create checkout session.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
