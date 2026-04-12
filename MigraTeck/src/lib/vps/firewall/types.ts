export type CanonicalFirewallRule = {
  id?: string;
  direction: "INBOUND" | "OUTBOUND";
  action: "ALLOW" | "DENY";
  protocol: "TCP" | "UDP" | "ICMP" | "ANY";
  portStart?: number;
  portEnd?: number;
  sourceCidr?: string;
  destinationCidr?: string;
  description?: string;
  priority: number;
  isEnabled: boolean;
  expiresAt?: string | null;
};

export type CanonicalFirewallState = {
  profileId?: string;
  profileName?: string;
  status?: "DRAFT" | "ACTIVE" | "APPLYING" | "FAILED" | "DISABLED";
  isEnabled?: boolean;
  isActive?: boolean;
  inboundDefaultAction: "ALLOW" | "DENY";
  outboundDefaultAction: "ALLOW" | "DENY";
  antiLockoutEnabled: boolean;
  rollbackWindowSec: number;
  providerVersion?: string | null;
  lastAppliedAt?: string | null;
  lastApplyJobId?: string | null;
  lastError?: string | null;
  rollbackPendingUntil?: string | null;
  confirmedAt?: string | null;
  driftDetectedAt?: string | null;
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
