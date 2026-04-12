import { prisma } from "@/lib/prisma";

export interface OrgPolicyData {
  requireMfa: boolean;
  allowedMfaMethods: string[];
  allowedEmailDomains: string[];
  maxSessionDurationH: number | null;
  requirePasskeyForAdmin: boolean;
  ipAllowlist: string[];
}

const DEFAULT_POLICY: OrgPolicyData = {
  requireMfa: false,
  allowedMfaMethods: [],
  allowedEmailDomains: [],
  maxSessionDurationH: null,
  requirePasskeyForAdmin: false,
  ipAllowlist: [],
};

export async function getOrgPolicy(orgId: string): Promise<OrgPolicyData> {
  const policy = await prisma.orgPolicy.findUnique({
    where: { orgId },
  });
  if (!policy) return { ...DEFAULT_POLICY };
  return {
    requireMfa: policy.requireMfa,
    allowedMfaMethods: policy.allowedMfaMethods,
    allowedEmailDomains: policy.allowedEmailDomains,
    maxSessionDurationH: policy.maxSessionDurationH,
    requirePasskeyForAdmin: policy.requirePasskeyForAdmin,
    ipAllowlist: policy.ipAllowlist,
  };
}

export async function upsertOrgPolicy(orgId: string, data: Partial<OrgPolicyData>) {
  return prisma.orgPolicy.upsert({
    where: { orgId },
    update: {
      ...(data.requireMfa !== undefined ? { requireMfa: data.requireMfa } : {}),
      ...(data.allowedMfaMethods !== undefined ? { allowedMfaMethods: data.allowedMfaMethods } : {}),
      ...(data.allowedEmailDomains !== undefined ? { allowedEmailDomains: data.allowedEmailDomains } : {}),
      ...(data.maxSessionDurationH !== undefined ? { maxSessionDurationH: data.maxSessionDurationH } : {}),
      ...(data.requirePasskeyForAdmin !== undefined ? { requirePasskeyForAdmin: data.requirePasskeyForAdmin } : {}),
      ...(data.ipAllowlist !== undefined ? { ipAllowlist: data.ipAllowlist } : {}),
    },
    create: {
      orgId,
      requireMfa: data.requireMfa ?? false,
      allowedMfaMethods: data.allowedMfaMethods ?? [],
      allowedEmailDomains: data.allowedEmailDomains ?? [],
      maxSessionDurationH: data.maxSessionDurationH ?? null,
      requirePasskeyForAdmin: data.requirePasskeyForAdmin ?? false,
      ipAllowlist: data.ipAllowlist ?? [],
    },
  });
}

// ── Policy enforcement checks ──

export interface PolicyViolation {
  code: string;
  message: string;
}

/**
 * Check if a user's email domain is allowed by org policy.
 * Returns null if allowed, or a violation if not.
 */
export function checkEmailDomainPolicy(
  policy: OrgPolicyData,
  email: string,
): PolicyViolation | null {
  if (policy.allowedEmailDomains.length === 0) return null;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { code: "INVALID_EMAIL", message: "Invalid email format" };
  if (!policy.allowedEmailDomains.includes(domain)) {
    return {
      code: "EMAIL_DOMAIN_RESTRICTED",
      message: `Email domain @${domain} is not allowed by organization policy`,
    };
  }
  return null;
}

/**
 * Check if the user satisfies the org MFA requirement.
 * Returns null if satisfied, or a violation if MFA is missing.
 */
export async function checkMfaPolicy(
  policy: OrgPolicyData,
  userId: string,
): Promise<PolicyViolation | null> {
  if (!policy.requireMfa) return null;

  const [totpFactor, passkeyCount] = await Promise.all([
    prisma.userTotpFactor.findUnique({ where: { userId }, select: { id: true } }),
    prisma.userPasskey.count({ where: { userId } }),
  ]);

  const hasMfa = !!totpFactor || passkeyCount > 0;
  if (!hasMfa) {
    return {
      code: "MFA_REQUIRED",
      message: "Organization policy requires multi-factor authentication",
    };
  }

  // Check allowed MFA methods if restricted
  if (policy.allowedMfaMethods.length > 0) {
    const userMethods: string[] = [];
    if (totpFactor) userMethods.push("totp");
    if (passkeyCount > 0) userMethods.push("passkey");

    const hasAllowed = userMethods.some((m) => policy.allowedMfaMethods.includes(m));
    if (!hasAllowed) {
      return {
        code: "MFA_METHOD_NOT_ALLOWED",
        message: `Organization requires one of: ${policy.allowedMfaMethods.join(", ")}`,
      };
    }
  }

  return null;
}

/**
 * Check if the client IP is allowed by org policy.
 */
export function checkIpAllowlistPolicy(
  policy: OrgPolicyData,
  clientIp: string | null | undefined,
): PolicyViolation | null {
  if (policy.ipAllowlist.length === 0) return null;
  if (!clientIp) {
    return { code: "IP_REQUIRED", message: "Client IP could not be determined" };
  }
  if (!policy.ipAllowlist.includes(clientIp)) {
    return {
      code: "IP_NOT_ALLOWED",
      message: "Access from this IP address is not allowed by organization policy",
    };
  }
  return null;
}

/**
 * Check if an admin user is required to have a passkey.
 */
export async function checkAdminPasskeyPolicy(
  policy: OrgPolicyData,
  userId: string,
  role: string,
): Promise<PolicyViolation | null> {
  if (!policy.requirePasskeyForAdmin) return null;
  if (role !== "OWNER" && role !== "ADMIN") return null;

  const passkeyCount = await prisma.userPasskey.count({ where: { userId } });
  if (passkeyCount === 0) {
    return {
      code: "ADMIN_PASSKEY_REQUIRED",
      message: "Organization policy requires passkeys for admin accounts",
    };
  }
  return null;
}

/**
 * Run all applicable org policies. Returns list of violations (empty = all passed).
 */
export async function enforceOrgPolicies(input: {
  orgId: string;
  userId: string;
  email: string;
  role: string;
  clientIp?: string | null;
}): Promise<PolicyViolation[]> {
  const policy = await getOrgPolicy(input.orgId);
  const violations: PolicyViolation[] = [];

  const emailViolation = checkEmailDomainPolicy(policy, input.email);
  if (emailViolation) violations.push(emailViolation);

  const mfaViolation = await checkMfaPolicy(policy, input.userId);
  if (mfaViolation) violations.push(mfaViolation);

  const ipViolation = checkIpAllowlistPolicy(policy, input.clientIp);
  if (ipViolation) violations.push(ipViolation);

  const adminPasskeyViolation = await checkAdminPasskeyPolicy(policy, input.userId, input.role);
  if (adminPasskeyViolation) violations.push(adminPasskeyViolation);

  return violations;
}
