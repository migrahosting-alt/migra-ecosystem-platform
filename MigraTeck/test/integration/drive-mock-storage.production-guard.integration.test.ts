import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: {
    NODE_ENV: "production",
  },
  downloadStorageProvider: "mock",
}));

describe("MigraDrive mock storage production guard", () => {
  test("mock upload route stays blocked when mock storage is requested in production", async () => {
    const { PUT } = await import("../../src/app/mock-upload/[...key]/route");

    const response = await PUT(
      new NextRequest("http://127.0.0.1:3109/mock-upload/tenants/test-org/example.txt?contentType=text/plain", {
        method: "PUT",
        body: "should-not-write",
        headers: {
          "content-type": "text/plain",
        },
      }),
      { params: Promise.resolve({ key: ["tenants", "test-org", "example.txt"] }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      ok: false,
      error: "mock_storage_production_disabled",
    });
  });
});