import { NextResponse } from "next/server";
import { z } from "zod";
import {
  forwardWorkforce,
  requireWorkforceWebSession,
} from "@/lib/platform/workforce-proxy";

const revokeSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("REVOKE PRODUCT ACCESS"),
});

export async function DELETE(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ staffId: string; grantId: string }>;
  },
) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  let body: z.infer<typeof revokeSchema>;
  try {
    body = revokeSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Provide a reason and type REVOKE PRODUCT ACCESS to confirm.",
      },
      { status: 400 },
    );
  }

  const { staffId, grantId } = await params;
  return forwardWorkforce(
    "/v1/admin/workforce/" +
      encodeURIComponent(staffId) +
      "/product-access/" +
      encodeURIComponent(grantId),
    {
      method: "DELETE",
      body: JSON.stringify(body),
    },
    "Platform OWNER product-access authority is required to revoke staff product roles.",
  );
}
