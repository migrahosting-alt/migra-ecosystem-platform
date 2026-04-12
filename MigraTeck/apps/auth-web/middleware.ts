import { NextResponse } from "next/server";

// No-op middleware for auth-web — all auth logic lives in auth-api.
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: [],
};
