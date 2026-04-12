import { NextResponse } from "next/server";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { status: 200, headers: { "Cache-Control": "no-store" }, ...init });
}

export function created<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, { status: 201, headers: { "Cache-Control": "no-store" }, ...init });
}

export function badRequest(message: string, details?: unknown) {
  return NextResponse.json({ error: { code: "BAD_REQUEST", message, details } }, { status: 400 });
}

export function unauthorized(message = "Unauthorized") {
  return NextResponse.json({ error: { code: "UNAUTHORIZED", message } }, { status: 401 });
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: { code: "FORBIDDEN", message } }, { status: 403 });
}

export function notFound(message = "Not found") {
  return NextResponse.json({ error: { code: "NOT_FOUND", message } }, { status: 404 });
}

export function notImplemented(message = "Not implemented", details?: unknown) {
  return NextResponse.json({ error: { code: "NOT_IMPLEMENTED", message, details } }, { status: 501 });
}

export function serverError(message = "Internal server error", details?: unknown) {
  return NextResponse.json({ error: { code: "INTERNAL_SERVER_ERROR", message, details } }, { status: 500 });
}
