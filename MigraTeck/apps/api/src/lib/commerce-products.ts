export const PRODUCT_KEYS = [
  "MIGRATECK",
  "MIGRAHOSTING",
  "MIGRAPANEL",
  "MIGRAVOICE",
  "MIGRAMAIL",
  "MIGRAINTAKE",
  "MIGRAMARKET",
  "MIGRAPILOT",
  "MIGRAINVOICE",
  "MIGRADRIVE",
  "MIGRABUILDER",
] as const;

export const ENTITLEMENT_STATUSES = [
  "ACTIVE",
  "TRIAL",
  "RESTRICTED",
  "INTERNAL_ONLY",
] as const;

export type ProductKey = (typeof PRODUCT_KEYS)[number];
export type EntitlementStatus = (typeof ENTITLEMENT_STATUSES)[number];

export const CATALOG_FAMILY_TO_PRODUCT: Record<string, ProductKey> = {
  builder: "MIGRABUILDER",
  hosting: "MIGRAHOSTING",
  intake: "MIGRAINTAKE",
  invoice: "MIGRAINVOICE",
  voice: "MIGRAVOICE",
  email: "MIGRAMAIL",
  marketing: "MIGRAMARKET",
  pilot: "MIGRAPILOT",
  drive: "MIGRADRIVE",
};
