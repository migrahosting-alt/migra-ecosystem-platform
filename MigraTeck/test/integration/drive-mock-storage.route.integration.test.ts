import fs from "node:fs/promises";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test } from "vitest";
import { getDriveMockStorageRoot } from "@/lib/drive/mock-storage";

describe("MigraDrive mock storage routes", () => {
  beforeEach(async () => {
    await fs.rm(getDriveMockStorageRoot(), { recursive: true, force: true });
  });

  test("mock upload and download roundtrip stored bytes", async () => {
    const { PUT } = await import("../../src/app/mock-upload/[...key]/route");
    const { GET } = await import("../../src/app/mock-download/[...key]/route");

    const uploadResponse = await PUT(
      new NextRequest("http://127.0.0.1:3109/mock-upload/tenants/test-org/example.txt?contentType=text/plain", {
        method: "PUT",
        body: "hello migradrive",
        headers: {
          "content-type": "text/plain",
        },
      }),
      { params: Promise.resolve({ key: ["tenants", "test-org", "example.txt"] }) },
    );

    expect(uploadResponse.status).toBe(200);

    const downloadResponse = await GET(
      new Request("http://127.0.0.1:3109/mock-download/tenants/test-org/example.txt"),
      { params: Promise.resolve({ key: ["tenants", "test-org", "example.txt"] }) },
    );

    expect(downloadResponse.status).toBe(200);
    expect(downloadResponse.headers.get("content-type")).toBe("text/plain");
    expect(await downloadResponse.text()).toBe("hello migradrive");
  });
});