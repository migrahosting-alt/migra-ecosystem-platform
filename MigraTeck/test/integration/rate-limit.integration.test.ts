import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { createRateLimitEvent, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Rate limit integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("request-password-reset is rate limited", async () => {
    const client = new HttpClient(baseUrl);

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const response = await client.post<{ message?: string }>("/api/auth/request-password-reset", {
        json: {
          email: "unknown-rate-limit@example.com",
        },
      });

      expect(response.status).toBe(200);
      expect(response.body?.message).toMatch(/If the account exists/i);
    }

    const blocked = await client.post<{ error?: string }>("/api/auth/request-password-reset", {
      json: {
        email: "unknown-rate-limit@example.com",
      },
    });

    expect(blocked.status).toBe(429);
    expect(blocked.body?.error).toMatch(/Too many reset attempts/i);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  test("cleanup path removes stale rate limit rows", async () => {
    const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);

    await createRateLimitEvent({
      key: "cleanup-key",
      action: "cleanup-action",
      createdAt: oldDate,
    });

    await createRateLimitEvent({
      key: "cleanup-key",
      action: "cleanup-action",
      createdAt: new Date(),
    });

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

    await assertRateLimit({
      key: "cleanup-key",
      action: "cleanup-action",
      maxAttempts: 10,
      windowSeconds: 60,
    });

    randomSpy.mockRestore();

    const remainingOldRows = await prisma.rateLimitEvent.count({
      where: {
        key: "cleanup-key",
        action: "cleanup-action",
        createdAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      },
    });

    expect(remainingOldRows).toBe(0);
  });
});
