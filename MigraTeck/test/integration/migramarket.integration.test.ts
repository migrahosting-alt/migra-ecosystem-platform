import { OrgRole, ProductKey } from "@prisma/client";
import { beforeEach, describe, expect, test } from "vitest";
import { createSessionForUser } from "../helpers/auth";
import { createEntitlement, createMembership, createOrganization, createPlatformConfig, createUser, resetDatabase } from "../helpers/fixtures";
import { HttpClient } from "../helpers/http";
import { prisma } from "../helpers/prisma";

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:3109";

describe("MigraMarket integration", () => {
  beforeEach(async () => {
    await resetDatabase();
    await createPlatformConfig({ allowOrgCreate: true, allowPublicSignup: true });
  });

  test("workspace API exposes seeded package templates and lead forms", async () => {
    const user = await createUser({
      email: "migramarket-owner@example.com",
      password: "MigraMarketPass123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Org",
      slug: "migramarket-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const response = await client.get<{
      workspace?: {
        packageTemplates: Array<{ code: string }>;
        leadForms: Array<{ slug: string; active: boolean }>;
        checklist: Array<{ key: string }>;
      };
    }>("/api/migramarket/workspace");

    expect(response.status).toBe(200);
    expect(response.body?.workspace?.packageTemplates.length).toBeGreaterThan(0);
    expect(response.body?.workspace?.packageTemplates.some((item) => item.code === "FULL_GROWTH_ENGINE")).toBe(true);
    expect(response.body?.workspace?.leadForms.some((item) => item.slug === "primary-intake" && item.active)).toBe(true);
    expect(response.body?.workspace?.checklist.some((item) => item.key === "baseline-report-ready")).toBe(true);
  });

  test("owner can create and manage package assignment, forms, leads, locations, tasks, and reports", async () => {
    const user = await createUser({
      email: "migramarket-admin@example.com",
      password: "MigraMarketAdmin123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Ops Org",
      slug: "migramarket-ops-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        packageTemplates: Array<{ id: string; code: string }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const packageTemplate = workspaceResponse.body?.workspace?.packageTemplates.find((item) => item.code === "FULL_GROWTH_ENGINE");
    expect(packageTemplate?.id).toBeTruthy();

    const assignPackageResponse = await client.post<{ assignedPackage?: { code: string } }>("/api/migramarket/package/assign", {
      json: {
        packageTemplateId: packageTemplate?.id,
      },
    });
    expect(assignPackageResponse.status).toBe(200);
    expect(assignPackageResponse.body?.assignedPackage?.code).toBe("FULL_GROWTH_ENGINE");

    const formResponse = await client.post<{ form?: { id: string; slug: string } }>("/api/migramarket/forms", {
      json: {
        name: "Paid Ads Form",
        slug: "paid-ads-form",
        sourceChannel: "google_ads",
        active: true,
      },
    });
    expect(formResponse.status).toBe(201);
    const formId = formResponse.body?.form?.id;
    expect(formId).toBeTruthy();

    const formPatch = await client.patch<{ form?: { name: string; active: boolean } }>(`/api/migramarket/forms/${formId}`, {
      json: {
        name: "Paid Ads Form Updated",
        active: false,
      },
    });
    expect(formPatch.status).toBe(200);
    expect(formPatch.body?.form?.name).toBe("Paid Ads Form Updated");
    expect(formPatch.body?.form?.active).toBe(false);

    const leadResponse = await client.post<{ lead?: { id: string; status: string } }>("/api/migramarket/leads", {
      json: {
        fullName: "Lead Prospect",
        email: "lead.prospect@example.com",
        sourceChannel: "manual",
        status: "new",
      },
    });
    expect(leadResponse.status).toBe(201);

    const locationResponse = await client.post<{ location?: { id: string; city: string } }>("/api/migramarket/locations", {
      json: {
        name: "Queens Office",
        city: "Queens",
        primary: true,
      },
    });
    expect(locationResponse.status).toBe(201);
    const locationId = locationResponse.body?.location?.id;
    expect(locationId).toBeTruthy();

    const locationPatch = await client.patch<{ location?: { city: string; serviceArea: string | null } }>(`/api/migramarket/locations/${locationId}`, {
      json: {
        city: "Brooklyn",
        serviceArea: "Brooklyn / Queens",
      },
    });
    expect(locationPatch.status).toBe(200);
    expect(locationPatch.body?.location?.city).toBe("Brooklyn");

    const taskResponse = await client.post<{ task?: { id: string; title: string } }>("/api/migramarket/tasks", {
      json: {
        title: "Prepare monthly content set",
        category: "social",
        priority: "high",
      },
    });
    expect(taskResponse.status).toBe(201);
    const taskId = taskResponse.body?.task?.id;
    expect(taskId).toBeTruthy();

    const taskPatch = await client.patch<{ task?: { status: string } }>(`/api/migramarket/tasks/${taskId}`, {
      json: {
        status: "in_progress",
      },
    });
    expect(taskPatch.status).toBe(200);
    expect(taskPatch.body?.task?.status).toBe("in_progress");

    const reportResponse = await client.post<{ report?: { id: string; label: string } }>("/api/migramarket/reports", {
      json: {
        label: "March 2026",
        periodStart: new Date("2026-03-01T00:00:00.000Z").toISOString(),
        periodEnd: new Date("2026-03-31T23:59:59.000Z").toISOString(),
        leads: 12,
        calls: 6,
      },
    });
    expect(reportResponse.status).toBe(201);
    const reportId = reportResponse.body?.report?.id;
    expect(reportId).toBeTruthy();

    const reportPatch = await client.patch<{ report?: { label: string; leads: number } }>(`/api/migramarket/reports/${reportId}`, {
      json: {
        label: "March 2026 Updated",
        leads: 14,
      },
    });
    expect(reportPatch.status).toBe(200);
    expect(reportPatch.body?.report?.label).toBe("March 2026 Updated");
    expect(reportPatch.body?.report?.leads).toBe(14);

    const leadId = leadResponse.body?.lead?.id;
    expect(leadId).toBeTruthy();
    const leadPatch = await client.patch<{ lead?: { status: string } }>(`/api/migramarket/leads/${leadId}`, {
      json: {
        status: "qualified",
      },
    });
    expect(leadPatch.status).toBe(200);
    expect(leadPatch.body?.lead?.status).toBe("qualified");

    const taskDelete = await client.delete<{ ok?: boolean }>(`/api/migramarket/tasks/${taskId}`);
    expect(taskDelete.status).toBe(200);
    expect(taskDelete.body?.ok).toBe(true);

    const reportDelete = await client.delete<{ ok?: boolean }>(`/api/migramarket/reports/${reportId}`);
    expect(reportDelete.status).toBe(200);
    expect(reportDelete.body?.ok).toBe(true);

    const locationDelete = await client.delete<{ ok?: boolean }>(`/api/migramarket/locations/${locationId}`);
    expect(locationDelete.status).toBe(200);
    expect(locationDelete.body?.ok).toBe(true);

    const formDelete = await client.delete<{ ok?: boolean }>(`/api/migramarket/forms/${formId}`);
    expect(formDelete.status).toBe(200);
    expect(formDelete.body?.ok).toBe(true);
  });

  test("public intake endpoint creates attributed lead records", async () => {
    const owner = await createUser({
      email: "migramarket-public-owner@example.com",
      password: "MigraMarketPublic123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Public Org",
      slug: "migramarket-public-org",
      createdById: owner.id,
    });

    await createMembership({ userId: owner.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: owner.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const ownerClient = new HttpClient(baseUrl);
    await createSessionForUser(ownerClient, owner.id);
    const workspace = await ownerClient.get("/api/migramarket/workspace");
    expect(workspace.status).toBe(200);

    const publicClient = new HttpClient(baseUrl);
    const response = await publicClient.post<{ ok?: boolean; thankYouMessage?: string }>("/api/migramarket/intake/submit", {
      json: {
        orgSlug: org.slug,
        formSlug: "primary-intake",
        fullName: "Public Intake Contact",
        email: "public.intake.contact@example.com",
        campaign: "maps-spring",
      },
      withOrigin: false,
    });

    expect(response.status).toBe(201);
    expect(response.body?.ok).toBe(true);

    const lead = await prisma.migraMarketLeadRecord.findFirst({
      where: {
        orgId: org.id,
        email: "public.intake.contact@example.com",
      },
      orderBy: { createdAt: "desc" },
    });

    expect(lead).toBeTruthy();
    expect(lead?.sourceChannel).toBe("website");
    expect(lead?.campaign).toBe("maps-spring");
  });

  test("workspace seeds governed website launch campaign assets and templates", async () => {
    const user = await createUser({
      email: "migramarket-governance-owner@example.com",
      password: "MigraMarketGov123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Governance Org",
      slug: "migramarket-governance-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const response = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ campaignKey?: string | null; approvedTemplateKeys?: string[]; disallowedAssetTags?: string[] }>;
        contentTemplates: Array<{ templateKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");

    expect(response.status).toBe(200);
    const websiteCampaign = response.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign).toBeTruthy();
    expect(websiteCampaign?.approvedTemplateKeys).toContain("website_offer_landscape_v1");
    expect(websiteCampaign?.disallowedAssetTags).toContain("hosting_pricing");
    expect(response.body?.workspace?.contentTemplates.some((item) => item.templateKey === "website_offer_youtube_v1")).toBe(true);
  });

  test("validation gate auto-selects approved website campaign creative and blocks mismatched publish copy", async () => {
    const user = await createUser({
      email: "migramarket-validator-owner@example.com",
      password: "MigraMarketValidate123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Validator Org",
      slug: "migramarket-validator-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ id: string; campaignKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const websiteCampaign = workspaceResponse.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign?.id).toBeTruthy();

    const createJobResponse = await client.post<{ job?: { id: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "Website launch LinkedIn post",
        platform: "linkedin",
        format: "post",
        publishMode: "api",
        status: "queued",
      },
    });
    expect(createJobResponse.status).toBe(201);
    const jobId = createJobResponse.body?.job?.id;
    expect(jobId).toBeTruthy();

    const validateResponse = await client.post<{
      job?: {
        validationStatus?: string;
        destinationUrl?: string | null;
        useLinkPreview?: boolean;
        selectedAsset?: { assetKey: string };
        captionVariant?: { captionKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${jobId}/validate`, {
      json: {},
    });
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body?.report?.final_status).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.validationStatus).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.selectedAsset?.assetKey).toBe("website_offer_landscape_v1");
    expect(validateResponse.body?.job?.captionVariant?.captionKey).toBe("website_48h_launch_linkedin_1");
    expect(validateResponse.body?.job?.destinationUrl).toBe("https://migrahosting.com/services");
    expect(validateResponse.body?.job?.useLinkPreview).toBe(true);

    const mismatchJob = await prisma.migraMarketContentJob.create({
      data: {
        orgId: org.id,
        briefId: websiteCampaign!.id,
        title: "Mismatched website post",
        platform: "linkedin",
        format: "post",
        publishMode: "api",
        status: "queued",
        caption: "NVMe hosting from $1.29/mo with instant server setup.",
      },
    });

    const blockedPublish = await client.post<{ error?: string }>(`/api/migramarket/social/jobs/${mismatchJob.id}/publish`, {
      json: {},
    });
    expect(blockedPublish.status).toBe(400);
    expect(blockedPublish.body?.error).toContain("caption_mismatch");
  });

  test("linkedin validation rotates website campaign caption and asset variants across jobs", async () => {
    const user = await createUser({
      email: "migramarket-linkedin-rotation@example.com",
      password: "MigraMarketRotate123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket LinkedIn Rotation Org",
      slug: "migramarket-linkedin-rotation-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ id: string; campaignKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const websiteCampaign = workspaceResponse.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign?.id).toBeTruthy();

    const createFirstJobResponse = await client.post<{ job?: { id: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "LinkedIn website post A",
        platform: "linkedin",
        format: "post",
        publishMode: "api",
        status: "queued",
      },
    });
    expect(createFirstJobResponse.status).toBe(201);

    const createSecondJobResponse = await client.post<{ job?: { id: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "LinkedIn website post B",
        platform: "linkedin",
        format: "post",
        publishMode: "api",
        status: "queued",
      },
    });
    expect(createSecondJobResponse.status).toBe(201);

    const firstJobId = createFirstJobResponse.body?.job?.id;
    const secondJobId = createSecondJobResponse.body?.job?.id;
    expect(firstJobId).toBeTruthy();
    expect(secondJobId).toBeTruthy();

    const firstValidation = await client.post<{
      job?: {
        validationStatus?: string;
        selectedAsset?: { assetKey: string };
        captionVariant?: { captionKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${firstJobId}/validate`, {
      json: {},
    });
    expect(firstValidation.status).toBe(200);
    expect(firstValidation.body?.report?.final_status).toBe("approved_for_publish");

    const secondValidation = await client.post<{
      job?: {
        validationStatus?: string;
        selectedAsset?: { assetKey: string };
        captionVariant?: { captionKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${secondJobId}/validate`, {
      json: {},
    });
    expect(secondValidation.status).toBe(200);
    expect(secondValidation.body?.report?.final_status).toBe("approved_for_publish");

    expect(firstValidation.body?.job?.captionVariant?.captionKey).not.toBe(secondValidation.body?.job?.captionVariant?.captionKey);
    expect(firstValidation.body?.job?.selectedAsset?.assetKey).not.toBe(secondValidation.body?.job?.selectedAsset?.assetKey);
  });

  test("validation ignores rogue off-campaign assets and keeps strict website campaign selection", async () => {
    const user = await createUser({
      email: "migramarket-strict-assets@example.com",
      password: "MigraMarketStrict123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Strict Asset Org",
      slug: "migramarket-strict-asset-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ id: string; campaignKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const websiteCampaign = workspaceResponse.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign?.id).toBeTruthy();

    await prisma.migraMarketContentAsset.create({
      data: {
        orgId: org.id,
        assetKey: "rogue_hosting_card_for_website",
        brand: "MigraHosting",
        category: "web_design",
        offer: "Wrong hosting fallback",
        styleFamily: "premium_dark_neon_business",
        platformTargets: ["linkedin", "x"],
        width: 1200,
        height: 628,
        aspectRatio: "1.91:1",
        fileUrl: "https://example.com/rogue-hosting-card.png",
        previewUrl: "https://example.com/rogue-hosting-card.png",
        landingPageIntent: "https://migrahosting.com/services",
        status: "approved",
        qualityScore: 9.9,
        tags: ["hosting", "hosting_pricing", "nvme"],
        campaignKeys: [],
        templateKey: "rogue_template",
        blacklistForCampaigns: [],
      },
    });

    const createJobResponse = await client.post<{ job?: { id: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "Strict website launch selection",
        platform: "linkedin",
        format: "post",
        publishMode: "api",
        status: "queued",
      },
    });
    expect(createJobResponse.status).toBe(201);
    const jobId = createJobResponse.body?.job?.id;
    expect(jobId).toBeTruthy();

    const validateResponse = await client.post<{
      job?: {
        validationStatus?: string;
        selectedAsset?: { assetKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${jobId}/validate`, {
      json: {},
    });
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body?.report?.final_status).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.validationStatus).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.selectedAsset?.assetKey).toBe("website_offer_landscape_v1");
  });

  test("facebook website campaign validation keeps link preview enabled for website ad posts", async () => {
    const user = await createUser({
      email: "migramarket-facebook-link-preview@example.com",
      password: "MigraMarketFacebook123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket Facebook Link Preview Org",
      slug: "migramarket-facebook-link-preview-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ id: string; campaignKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const websiteCampaign = workspaceResponse.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign?.id).toBeTruthy();

    const createJobResponse = await client.post<{ job?: { id: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "Website launch Facebook ad",
        platform: "facebook",
        format: "post",
        publishMode: "api",
        status: "queued",
      },
    });
    expect(createJobResponse.status).toBe(201);
    const jobId = createJobResponse.body?.job?.id;
    expect(jobId).toBeTruthy();

    const validateResponse = await client.post<{
      job?: {
        validationStatus?: string;
        destinationUrl?: string | null;
        useLinkPreview?: boolean;
        selectedAsset?: { assetKey: string };
        captionVariant?: { captionKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${jobId}/validate`, {
      json: {},
    });
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body?.report?.final_status).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.validationStatus).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.selectedAsset?.assetKey).toBe("website_offer_landscape_v1");
    expect(validateResponse.body?.job?.captionVariant?.captionKey).toBe("website_48h_launch_facebook_1");
    expect(validateResponse.body?.job?.destinationUrl).toBe("https://migrahosting.com/services");
    expect(validateResponse.body?.job?.useLinkPreview).toBe(true);
  });

  test("x validation disables link preview for website campaign posts", async () => {
    const user = await createUser({
      email: "migramarket-x-preview-guard@example.com",
      password: "MigraMarketXGuard123!",
      emailVerified: true,
    });

    const org = await createOrganization({
      name: "MigraMarket X Guard Org",
      slug: "migramarket-x-guard-org",
      createdById: user.id,
    });

    await createMembership({ userId: user.id, orgId: org.id, role: OrgRole.OWNER });
    await prisma.user.update({ where: { id: user.id }, data: { defaultOrgId: org.id } });
    await createEntitlement({ orgId: org.id, product: ProductKey.MIGRAMARKET });

    const client = new HttpClient(baseUrl);
    await createSessionForUser(client, user.id);

    const workspaceResponse = await client.get<{
      workspace?: {
        creativeBriefs: Array<{ id: string; campaignKey?: string | null }>;
      };
    }>("/api/migramarket/workspace");
    expect(workspaceResponse.status).toBe(200);
    const websiteCampaign = workspaceResponse.body?.workspace?.creativeBriefs.find((item) => item.campaignKey === "website_48h_launch");
    expect(websiteCampaign?.id).toBeTruthy();

    const createJobResponse = await client.post<{ job?: { id: string; useLinkPreview?: boolean; platform?: string } }>("/api/migramarket/social/jobs", {
      json: {
        briefId: websiteCampaign?.id,
        title: "X website launch post",
        platform: "x",
        format: "post",
        publishMode: "api",
        status: "queued",
        useLinkPreview: true,
      },
    });
    expect(createJobResponse.status).toBe(201);
    const jobId = createJobResponse.body?.job?.id;
    expect(jobId).toBeTruthy();

    const validateResponse = await client.post<{
      job?: {
        validationStatus?: string;
        useLinkPreview?: boolean;
        selectedAsset?: { assetKey: string };
      };
      report?: { final_status: string };
    }>(`/api/migramarket/social/jobs/${jobId}/validate`, {
      json: {},
    });
    expect(validateResponse.status).toBe(200);
    expect(validateResponse.body?.report?.final_status).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.validationStatus).toBe("approved_for_publish");
    expect(validateResponse.body?.job?.useLinkPreview).toBe(false);
    expect(validateResponse.body?.job?.selectedAsset?.assetKey).toBe("website_offer_landscape_v1");
  });
});
