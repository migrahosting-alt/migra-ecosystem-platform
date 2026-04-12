import { NextRequest } from "next/server";
import { handleServerAction } from "@/lib/vps/handlers";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await context.params;

  return handleServerAction({
    request,
    serverId,
    rateLimit: {
      action: "vps:power:off",
      maxAttempts: 10,
      windowSeconds: 15 * 60,
    },
    actionType: "POWER_OFF",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "POWER_OFF_REQUESTED",
  });
}
