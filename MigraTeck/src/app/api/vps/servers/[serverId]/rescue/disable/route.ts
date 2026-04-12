import { NextRequest } from "next/server";
import { handleServerAction } from "@/lib/vps/handlers";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await context.params;

  return handleServerAction({
    request,
    serverId,
    rateLimit: {
      action: "vps:rescue:disable",
      maxAttempts: 6,
      windowSeconds: 15 * 60,
    },
    actionType: "DISABLE_RESCUE",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "RESCUE_DISABLE_REQUESTED",
  });
}
