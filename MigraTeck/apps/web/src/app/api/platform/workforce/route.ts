import { NextResponse } from "next/server";
import { z } from "zod";
import { fetchAuthApi } from "@/lib/auth/api";
import {
  forwardWorkforce,
  requireWorkforceWebSession,
} from "@/lib/platform/workforce-proxy";

type AuthorityResponse = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

type WorkforceListResponse = {
  total: number;
  staff: unknown[];
};

const employmentTypes = ["employee", "contractor", "intern", "vendor"] as const;

const createSchema = z.object({
  email: z.string().trim().email().max(320),
  display_name: z.string().trim().min(1).max(120).optional(),
  employment_type: z.enum(employmentTypes).default("employee"),
  job_title: z.string().trim().max(120).optional(),
  department: z.string().trim().max(120).optional(),
  team: z.string().trim().max(120).optional(),
  manager_staff_id: z.string().trim().max(48).optional(),
  starts_at: z.string().datetime({ offset: true }).optional(),
  reason: z.string().trim().min(10).max(1000),
  confirmation: z.literal("CREATE STAFF"),
});

export async function GET(request: Request) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  const authority = await fetchAuthApi<AuthorityResponse>("/v1/admin/me");
  if (!authority.ok) {
    if (authority.status === 403) {
      return NextResponse.json({
        operator: false,
        canRead: false,
        canManageWorkforce: false,
        canManageProductAccess: false,
        authority: null,
        total: 0,
        staff: [],
      });
    }
    return NextResponse.json(
      { error: authority.error },
      { status: authority.status },
    );
  }

  const permissions = new Set(authority.data.permissions);
  const canRead = permissions.has("platform.workforce.read");
  const canManageWorkforce = permissions.has("platform.workforce.manage");
  const canManageProductAccess = permissions.has(
    "platform.workforce.product_access.manage",
  );

  if (!canRead) {
    return NextResponse.json({
      operator: true,
      canRead: false,
      canManageWorkforce,
      canManageProductAccess,
      authority: authority.data,
      total: 0,
      staff: [],
    });
  }

  const input = new URL(request.url).searchParams;
  const params = new URLSearchParams();
  const q = input.get("q")?.trim();
  const limit = input.get("limit");
  const offset = input.get("offset");
  if (q) params.set("q", q);
  params.set("limit", limit ?? "50");
  params.set("offset", offset ?? "0");

  const listing = await fetchAuthApi<WorkforceListResponse>(
    "/v1/admin/workforce?" + params.toString(),
  );
  if (!listing.ok) {
    return NextResponse.json(
      { error: listing.error },
      { status: listing.status },
    );
  }

  return NextResponse.json({
    operator: true,
    canRead,
    canManageWorkforce,
    canManageProductAccess,
    authority: authority.data,
    ...listing.data,
  });
}

export async function POST(request: Request) {
  const context = await requireWorkforceWebSession();
  if (!context.ok) return context.response;

  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      {
        error:
          "Enter a valid staff identity, a reason of at least 10 characters, and type CREATE STAFF.",
      },
      { status: 400 },
    );
  }

  return forwardWorkforce(
    "/v1/admin/workforce",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    "Platform OWNER workforce authority is required to create staff identities.",
  );
}
