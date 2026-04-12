import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgContext } from "@/lib/auth/org-context";
import { getUsageSummary, getOrgQuotas } from "@/lib/usage";
import { ProductKey } from "@prisma/client";

const querySchema = z.object({
  product: z.nativeEnum(ProductKey).optional(),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ orgId: string }> },
) {
  const result = await requireOrgContext(request, context);
  if (!result.ok) return result.response;

  const searchParams = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = querySchema.safeParse(searchParams);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters." }, { status: 400 });
  }

  const since = parsed.data.since ? new Date(parsed.data.since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const until = parsed.data.until ? new Date(parsed.data.until) : undefined;

  const [quotas, usage] = await Promise.all([
    getOrgQuotas(result.ctx.orgId),
    parsed.data.product
      ? getUsageSummary(result.ctx.orgId, parsed.data.product, since, until)
      : [],
  ]);

  return NextResponse.json({
    quotas: quotas.map((q) => ({
      product: q.product,
      metric: q.metric,
      limit: q.limitValue.toString(),
      used: q.currentUsed.toString(),
      periodStart: q.periodStart,
      periodEnd: q.periodEnd,
    })),
    usage: usage.map((u) => ({
      metric: u.metric,
      total: u.total.toString(),
    })),
  });
}
