import { NextRequest } from "next/server";
import { proxyLaunchServiceJson } from "@/lib/launch-service";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  return proxyLaunchServiceJson(request, "/api/launch/business/preview", {
    method: "POST",
    body,
  });
}
