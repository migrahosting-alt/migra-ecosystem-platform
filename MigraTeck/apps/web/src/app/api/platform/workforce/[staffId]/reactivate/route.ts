import { NextResponse } from "next/server";
import { z } from "zod";
import {
  forwardWorkforce,
  requireWorkforceWebSession,
} from "@/lib/platform/workforce-proxy";

const bodySchema = z.object({
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("REACTIVATE STAFF"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ staffId: string }> },
) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Provide a reason and type REACTIVATE STAFF to confirm.",
      },
      { status: 400 },
    );
  }

  const { staffId } = await params;
  return forwardWorkforce(
    "/v1/admin/workforce/" +
      encodeURIComponent(staffId) +
      "/reactivate",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    "Platform OWNER workforce authority is required to reactivate staff identities.",
  );
}
