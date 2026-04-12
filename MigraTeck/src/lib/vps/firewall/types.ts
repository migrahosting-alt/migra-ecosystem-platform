export type CanonicalFirewallRule = {
  id?: string | undefined;
  direction: "INBOUND" | "OUTBOUND";
  action: "ALLOW" | "DENY";
  protocol: "TCP" | "UDP" | "ICMP" | "ANY";
  portStart?: number | undefined;
  portEnd?: number | undefined;
  sourceCidr?: string | undefined;
  destinationCidr?: string | undefined;
  description?: string | undefined;
  priority: number;
  isEnabled: boolean;
  expiresAt?: string | null | undefined;
};

export type CanonicalFirewallState = {
  profileId?: string | undefined;
  profileName?: string | undefined;
  status?: "DRAFT" | "ACTIVE" | "APPLYING" | "FAILED" | "DISABLED" | undefined;
  isEnabled?: boolean | undefined;
  isActive?: boolean | undefined;
  inboundDefaultAction: "ALLOW" | "DENY";
  outboundDefaultAction: "ALLOW" | "DENY";
  antiLockoutEnabled: boolean;
  rollbackWindowSec: number;
  providerVersion?: string | null | undefined;
  lastAppliedAt?: string | null | undefined;
  lastApplyJobId?: string | null | undefined;
  lastError?: string | null | undefined;
  rollbackPendingUntil?: string | null | undefined;
  confirmedAt?: string | null | undefined;
  driftDetectedAt?: string | null | undefined;
  rules: CanonicalFirewallRule[];
};

export type FirewallValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  antiLockoutSatisfied: boolean;
};

export type FirewallApplyPreview = {
  added: CanonicalFirewallRule[];
  removed: CanonicalFirewallRule[];
  changed: Array<{
    before: CanonicalFirewallRule;
    after: CanonicalFirewallRule;
  }>;
  warnings: string[];
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
};

export type FirewallTemplate = {
  slug: string;
  name: string;
  description: string;
  state: CanonicalFirewallState;
};
