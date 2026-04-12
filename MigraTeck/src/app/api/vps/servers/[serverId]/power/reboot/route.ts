import { NextRequest } from "next/server";
import { handleServerAction } from "@/lib/vps/handlers";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await context.params;

  return handleServerAction({
    request,
    serverId,
    rateLimit: {
      action: "vps:power:reboot",
      maxAttempts: 10,
      windowSeconds: 15 * 60,
    },
    actionType: "REBOOT",
    allowedRoles: ["OWNER", "ADMIN", "OPERATOR"],
    eventType: "REBOOT_REQUESTED",
  });
}
