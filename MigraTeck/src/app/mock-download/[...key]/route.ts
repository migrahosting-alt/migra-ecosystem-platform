import { NextResponse } from "next/server";
import { getMockStorageAvailability, readMockStoredObject } from "@/lib/drive/mock-storage";

export async function GET(
  _request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  const availability = getMockStorageAvailability();
  if (!availability.ok) {
    return NextResponse.json({ ok: false, error: availability.error }, { status: availability.status });
  }

  const { key } = await context.params;
  const fileKey = key.join("/");
  const storedObject = await readMockStoredObject(fileKey);

  if (!storedObject) {
    return NextResponse.json({ ok: false, error: "mock_object_not_found" }, { status: 404 });
  }

  return new NextResponse(storedObject.body, {
    status: 200,
    headers: {
      "content-length": String(storedObject.body.length),
      "content-type": storedObject.contentType,
      "cache-control": "private, max-age=60",
    },
  });
}