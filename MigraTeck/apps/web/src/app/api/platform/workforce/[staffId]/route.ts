import {
  forwardWorkforce,
  requireWorkforceWebSession,
} from "@/lib/platform/workforce-proxy";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ staffId: string }> },
) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  const { staffId } = await params;
  return forwardWorkforce(
    "/v1/admin/workforce/" + encodeURIComponent(staffId),
    {},
    "Workforce read authority is required to inspect staff identities.",
  );
}
