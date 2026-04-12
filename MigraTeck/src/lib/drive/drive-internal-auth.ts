import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export function extractBearerToken(request: NextRequest | Request): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export function isAuthorizedInternalDriveRequest(request: NextRequest | Request): boolean {
  const configured = env.MIGRADRIVE_INTERNAL_PROVISION_TOKEN?.trim();
  if (!configured) {
    return false;
  }

  return extractBearerToken(request) === configured;
}

export function unauthorizedDriveResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}