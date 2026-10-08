import { NextResponse } from "next/server";
import { z } from "zod";
import {
  forwardWorkforce,
  requireWorkforceWebSession,
} from "@/lib/platform/workforce-proxy";

const products = [
  "frendelo",
  "migrateck",
  "migrahosting",
  "migrapanel",
  "pale",
  "migramail",
  "migravoice",
  "migradrive",
  "migrapilot",
  "migraintake",
  "migremarket",
  "migrainvoice",
  "migrabuilder",
] as const;

const grantSchema = z.object({
  product: z.enum(products),
  role_key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z][a-z0-9_.-]*$/),
  reason: z.string().trim().min(10).max(1000),
  expires_at: z.string().datetime({ offset: true }).optional(),
  confirmation: z.string().trim().min(1).max(80),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ staffId: string }> },
) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  let body: z.infer<typeof grantSchema>;
  try {
    body = grantSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Choose a valid product and role key, provide a reason, and enter the required confirmation.",
      },
      { status: 400 },
    );
  }

  const requiredConfirmation =
    body.product === "frendelo" && body.role_key === "super_admin"
      ? "GRANT FRENDELO SUPER ADMIN"
      : "GRANT PRODUCT ACCESS";
  if (body.confirmation !== requiredConfirmation) {
    return NextResponse.json(
      { error: "Type " + requiredConfirmation + " to confirm this grant." },
      { status: 400 },
    );
  }

  const { staffId } = await params;
  return forwardWorkforce(
    "/v1/admin/workforce/" +
      encodeURIComponent(staffId) +
      "/product-access",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    "Platform OWNER product-access authority is required to grant staff product roles.",
  );
}
