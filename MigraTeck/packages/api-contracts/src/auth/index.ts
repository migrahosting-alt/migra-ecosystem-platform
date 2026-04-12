import { z } from "zod";

export const roleSchema = z.enum(["OWNER", "ADMIN", "BILLING", "MEMBER", "READONLY"]);
export type IdentityRole = z.infer<typeof roleSchema>;

export const userStatusSchema = z.enum(["PENDING_VERIFICATION", "ACTIVE", "LOCKED", "DISABLED"]);
export type IdentityUserStatus = z.infer<typeof userStatusSchema>;

export const signupRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email(),
  password: z.string().min(12).max(256),
  organizationName: z.string().trim().min(2).max(120),
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().min(20),
});

export const resendVerificationRequestSchema = z.object({
  email: z.string().trim().email(),
});

export const forgotPasswordRequestSchema = z.object({
  email: z.string().trim().email(),
});

export const resetPasswordRequestSchema = z.object({
  token: z.string().min(20),
  password: z.string().min(12).max(256),
});

export const loginRequestSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
});

export const switchOrganizationRequestSchema = z.object({
  orgId: z.string().min(10),
});

export interface IdentityUserView {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
  status: IdentityUserStatus;
  emailVerifiedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface IdentityOrganizationView {
  id: string;
  name: string;
  slug: string;
}

export interface IdentityMembershipView {
  membershipId: string;
  organization: IdentityOrganizationView;
  role: IdentityRole;
  joinedAt: string;
  isCurrent: boolean;
}

export interface IdentitySessionView {
  expiresAt: string;
  refreshTokenExpiresAt: string | null;
  trusted: boolean;
}

export interface IdentityManagedSessionView {
  id: string;
  organization: IdentityOrganizationView | null;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
  revokedAt: string | null;
}

export interface IdentityContextView {
  user: IdentityUserView;
  activeOrganization: IdentityOrganizationView | null;
  activeRole: IdentityRole | null;
  memberships: IdentityMembershipView[];
  accessToken?: string;
  session?: IdentitySessionView;
}

export interface SignupResponseData {
  created: boolean;
  verificationRequired: boolean;
  message: string;
  user: Pick<IdentityUserView, "id" | "email" | "displayName" | "status"> | null;
  organization: IdentityOrganizationView | null;
}

export interface VerifyEmailResponseData {
  message: string;
  emailVerifiedAt: string;
}

export interface GenericAuthMessageData {
  message: string;
}

export interface IdentitySessionListResponseData {
  sessions: IdentityManagedSessionView[];
  nextCursor: string | null;
}