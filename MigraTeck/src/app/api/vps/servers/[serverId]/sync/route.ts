import { NextRequest } from "next/server";
import { handleServerAction } from "@/lib/vps/handlers";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await context.params;

  return handleServerAction({
    request,
    serverId,
    rateLimit: {
      action: "vps:sync",
      maxAttempts: 60,
      windowSeconds: 60 * 60,
    },
    actionType: "MANUAL_SYNC",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "MANUAL_SYNC_REQUESTED",
  });
}
