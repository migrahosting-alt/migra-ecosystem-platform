import { beforeEach, describe, expect, test } from "vitest";
import { resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Public request access integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("accepts public access request and records audit log", async () => {
    const client = new HttpClient(baseUrl);

    const created = await client.post<{
      message?: string;
      reference?: string;
      responseSlaBusinessDays?: number;
      confirmationEmailSent?: boolean;
    }>("/api/auth/request-access", {
      json: {
        name: "Access Request User",
        email: "access.request@example.com",
        company: "Example Telecom",
        useCase: "We need workspace onboarding for a staged pilot across two internal teams this quarter.",
        productInterest: "MigraHosting VPS",
        planInterest: "VPS 2",
        billingPreference: "yearly",
        sourceContext: "marketing:pricing:vps-plan",
      },
    });

    expect(created.status).toBe(202);
    expect(created.body?.message).toMatch(/Access request received/i);
    expect(created.body?.reference).toBeTruthy();
    expect(created.body?.responseSlaBusinessDays).toBe(2);
    expect(created.body?.confirmationEmailSent).toBe(false);

    const audit = await prisma.auditLog.findFirst({
      where: {
        action: "AUTH_REQUEST_ACCESS_SUBMITTED",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    expect(audit).toBeTruthy();
    expect(audit?.metadata).toBeTruthy();

    const auditDetails =
      audit?.metadata && typeof audit.metadata === "object" && "details" in audit.metadata
        ? (audit.metadata.details as Record<string, unknown>)
        : null;

    expect(auditDetails).toMatchObject({
      productInterest: "MigraHosting VPS",
      planInterest: "VPS 2",
      billingPreference: "yearly",
      sourceContext: "marketing:pricing:vps-plan",
    });

    const csrfDenied = await client.post<{ error?: string }>("/api/auth/request-access", {
      json: {
        name: "Denied User",
        email: "denied@example.com",
        company: "Denied Org",
        useCase: "Need onboarding and access to test product APIs for launch planning this month.",
      },
      withOrigin: false,
    });

    expect(csrfDenied.status).toBe(403);
    expect(csrfDenied.body?.error).toBe("CSRF validation failed.");
  });
});
