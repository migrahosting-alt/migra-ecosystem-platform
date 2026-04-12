import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetDatabase } from "../helpers/fixtures";
import { prisma } from "../helpers/prisma";

const baseEnv = { ...process.env };

describe("Revenue provision integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.resetModules();
    process.env = {
      ...baseEnv,
      NODE_ENV: "test",
      MARKET_INTERNAL_PROVISION_TOKEN: "integration-market-token",
    };
  });

  test("preserves hosting provisioning context on queued jobs", async () => {
    const { POST } = await import("../../src/app/api/internal/revenue-provision/route");

    const request = new NextRequest("http://127.0.0.1:3109/api/internal/revenue-provision", {
      method: "POST",
      headers: {
        authorization: "Bearer integration-market-token",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source: "migra-market.revenue.close_deal",
        company: "Context Hosting LLC",
        plan: "MigraHosting Starter",
        product: "MH",
        tenantId: "tenant_ctx_001",
        serviceInstanceId: "svc_ctx_001",
        domain: "context-hosting.example.com",
        targetIp: "10.10.10.5",
        limits: {
          diskGb: 25,
          bandwidthGb: 250,
        },
        revenueCustomerId: "rev_customer_ctx_001",
        contactEmail: "ops@context-hosting.example.com",
        contactName: "Ops Team",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);

    const jobs = await prisma.provisioningJob.findMany({
      where: {
        orgId: body.org.id,
      },
      orderBy: { createdAt: "asc" },
    });

    expect(jobs.length).toBe(3);

    for (const job of jobs) {
      const payload = job.payload as Record<string, unknown>;
      expect(payload.product).toBe("MIGRAHOSTING");
      expect(payload.productLane).toBe("MIGRAHOSTING");
      expect(payload.tenantId).toBe("tenant_ctx_001");
      expect(payload.serviceInstanceId).toBe("svc_ctx_001");
      expect(payload.domain).toBe("context-hosting.example.com");
      expect(payload.targetIp).toBe("10.10.10.5");
      expect(payload.contactEmail).toBe("ops@context-hosting.example.com");
      expect(payload.contactName).toBe("Ops Team");
      expect(payload.revenueCustomerId).toBe("rev_customer_ctx_001");
      expect(payload.plan).toBe("MigraHosting Starter");
      expect(payload.reference).toBeTruthy();
      expect(payload.limits).toEqual({
        diskGb: 25,
        bandwidthGb: 250,
      });
    }
  });
});
