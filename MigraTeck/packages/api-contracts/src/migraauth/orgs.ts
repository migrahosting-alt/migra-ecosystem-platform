export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: string;
  joined_at: string;
}

export interface MigraAuthOrganizationsResponse {
  organizations: OrganizationSummary[];
}

export interface MigraAuthCreateOrganizationRequest {
  name: string;
  slug: string;
}

export interface MigraAuthCreateOrganizationResponse {
  id: string;
  name: string;
  slug: string;
}

export interface MigraAuthAddOrganizationMemberRequest {
  email: string;
  role: "admin" | "billing_admin" | "member";
}

export interface MigraAuthAddOrganizationMemberResponse {
  member_id: string;
  user_id: string;
  role: "admin" | "billing_admin" | "member";
}