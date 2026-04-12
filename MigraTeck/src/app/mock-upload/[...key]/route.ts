import { NextRequest, NextResponse } from "next/server";
import { getMockStorageAvailability, writeMockStoredObject } from "@/lib/drive/mock-storage";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ key: string[] }> },
) {
  const availability = getMockStorageAvailability();
  if (!availability.ok) {
    return NextResponse.json({ ok: false, error: availability.error }, { status: availability.status });
  }

  const { key } = await context.params;
  const fileKey = key.join("/");
  const contentType =
    request.nextUrl.searchParams.get("contentType")
    || request.headers.get("content-type")
    || "application/octet-stream";
  const body = Buffer.from(await request.arrayBuffer());

  await writeMockStoredObject(fileKey, body, contentType);

  return new NextResponse(null, {
    status: 200,
    headers: {
      etag: `${body.length}`,
    },
  });
}