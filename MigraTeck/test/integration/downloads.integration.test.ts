import { EntitlementStatus, OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import {
  createDownloadArtifact,
  createEntitlement,
  createMembership,
  createOrganization,
  createUser,
  resetDatabase,
} from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("Downloads integration", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("listing and sign endpoint enforce entitlement status", async () => {
    const user = await createUser({
      email: "downloads-user@example.com",
      password: "DownloadsPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "Downloads Org",
      slug: "downloads-org",
      isMigraHostingClient: true,
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.MEMBER });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAVOICE, status: EntitlementStatus.TRIAL });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAPANEL, status: EntitlementStatus.RESTRICTED });

    const voiceArtifact = await createDownloadArtifact({
      name: "MigraVoice Desktop",
      product: ProductKey.MIGRAVOICE,
      version: "2.3.1",
      fileKey: "migravoice/2.3.1/desktop.zip",
    });

    const panelArtifact = await createDownloadArtifact({
      name: "MigraPanel Agent",
      product: ProductKey.MIGRAPANEL,
      version: "5.4.0",
      fileKey: "migrapanel/5.4.0/agent.zip",
    });

    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const list = await client.get<{
      downloads?: Array<{ id: string; product: ProductKey; entitled: boolean }>;
    }>("/api/downloads", { withOrigin: false });

    expect(list.status).toBe(200);

    const voiceRow = list.body?.downloads?.find((row) => row.id === voiceArtifact.id);
    const panelRow = list.body?.downloads?.find((row) => row.id === panelArtifact.id);

    expect(voiceRow?.entitled).toBe(true);
    expect(panelRow?.entitled).toBe(false);

    const denied = await client.post<{ error?: string }>(`/api/downloads/${panelArtifact.id}/sign`, {
      json: {},
    });

    expect(denied.status).toBe(403);

    const allowed = await client.post<{ signedUrl?: string }>(`/api/downloads/${voiceArtifact.id}/sign`, {
      json: {},
    });

    expect(allowed.status).toBe(200);
    expect(allowed.body?.signedUrl).toBe(`${baseUrl}/mock-download/migravoice/2.3.1/desktop.zip?ttlSeconds=300`);

    await prisma.orgEntitlement.update({
      where: {
        orgId_product: {
          orgId: org.id,
          product: ProductKey.MIGRAVOICE,
        },
      },
      data: {
        endsAt: new Date(Date.now() - 60_000),
      },
    });

    const expired = await client.post<{ error?: string }>(`/api/downloads/${voiceArtifact.id}/sign`, {
      json: {},
    });

    expect(expired.status).toBe(403);
    expect(expired.body?.error).toBe("Forbidden");

    const deniedAudit = await prisma.auditLog.findFirst({
      where: {
        userId: user.id,
        orgId: org.id,
        action: "ENTITLEMENT_ENFORCEMENT_DENIED",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(deniedAudit).toBeTruthy();
  });
});
