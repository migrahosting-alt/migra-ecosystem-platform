import { getAppSession, setAppSession } from "@migrateck/auth-client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { fetchAuthApi } from "@/lib/auth/api";
import { derivePlatformPermissions } from "@/lib/auth/permissions";

const createOrgBody = z.object({
  name: z.string().min(2).max(100),
  slug: z
    .string()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Slug must be lowercase alphanumeric with hyphens"),
});

/**
 * GET /api/platform/organizations — list user's organizations
 */
export async function GET() {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await fetchAuthApi<{
    organizations: Array<{
      id: string;
      name: string;
      slug: string;
      role: string;
      joined_at: string;
    }>;
  }>("/v1/organizations");

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.data);
}

/**
 * POST /api/platform/organizations — create a new organization
 */
export async function POST(request: Request) {
  ensureAuthClientInitialized();
  const session = await getAppSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof createOrgBody>;
  try {
    body = createOrgBody.parse(await request.json());
  } catch (err) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const result = await fetchAuthApi<{ id: string; name: string; slug: string }>(
    "/v1/organizations",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // Update the session to include the new org
  const newOrg = result.data;
  const pa = (session.productAccount ?? {}) as Record<string, unknown>;
  const existingOrgs = Array.isArray(pa.organizations) ? pa.organizations : [];

  const updatedOrgs = [
    ...existingOrgs,
    {
      id: newOrg.id,
      name: newOrg.name,
      slug: newOrg.slug,
      role: "OWNER",
      joinedAt: new Date().toISOString(),
    },
  ];

  // If this is the first org, set it as active
  const isFirstOrg = existingOrgs.length === 0;

  await setAppSession({
    ...session,
    ...(isFirstOrg
      ? {
          activeOrgId: newOrg.id,
          activeOrgName: newOrg.name,
          activeOrgRole: "OWNER",
          permissions: derivePlatformPermissions("OWNER"),
        }
      : {}),
    productAccount: {
      ...pa,
      onboardingStep: "complete",
      organizations: updatedOrgs,
    },
  });

  return NextResponse.json(newOrg, { status: 201 });
}
