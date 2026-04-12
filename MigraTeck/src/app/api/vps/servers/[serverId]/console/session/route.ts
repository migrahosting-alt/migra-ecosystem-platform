import { NextRequest } from "next/server";
import { handleLegacyConsoleSessionRequest } from "@/lib/vps/handlers";

export async function POST(request: NextRequest, context: { params: Promise<{ serverId: string }> }) {
  return handleLegacyConsoleSessionRequest({
    request,
    params: context.params,
    rateLimit: {
      action: "vps:console:session",
      maxAttempts: 20,
      windowSeconds: 15 * 60,
    },
    errorMessage: "Console session failed.",
  });
}
