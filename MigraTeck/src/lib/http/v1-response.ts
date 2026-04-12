import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorEnvelope, successEnvelope } from "@migrateck/api-contracts";
import { isAuthCoreError } from "@migrateck/auth-core";

function noStoreHeaders(headers?: HeadersInit): HeadersInit {
  return {
    "Cache-Control": "no-store",
    ...(headers || {}),
  };
}

export function jsonSuccess<T>(data: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(successEnvelope(data), {
    status,
    headers: noStoreHeaders(headers),
  });
}

export function jsonError(code: string, message: string, status = 400, headers?: HeadersInit) {
  return NextResponse.json(errorEnvelope(code, message), {
    status,
    headers: noStoreHeaders(headers),
  });
}

export function jsonFromError(error: unknown) {
  if (isAuthCoreError(error)) {
    return jsonError(error.code, error.message, error.status);
  }

  if (error instanceof ZodError) {
    return jsonError("INVALID_PAYLOAD", "Invalid payload.", 400);
  }

  console.error(error);
  return jsonError("INTERNAL_ERROR", "Internal server error.", 500);
}