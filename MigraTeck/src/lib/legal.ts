import type { Metadata } from "next";
import { migradrivePublicConfig, migradriveWebsiteHost } from "@/lib/migradrive-public-config";

export const LEGAL_PAGE_PATHS = {
  privacy: "/privacy",
  terms: "/terms",
} as const;

export const MIGRADRIVE_LEGAL_LAST_UPDATED = migradrivePublicConfig.legalLastUpdated;

export const MIGRADRIVE_LEGAL_CONTACT = {
  brandName: migradrivePublicConfig.brandName,
  operatorName: migradrivePublicConfig.operatorName,
  websiteUrl: migradrivePublicConfig.websiteUrl,
  websiteHost: migradriveWebsiteHost,
  privacyEmail: migradrivePublicConfig.privacyEmail,
  legalEmail: migradrivePublicConfig.legalEmail,
  supportEmail: migradrivePublicConfig.supportEmail,
  addressLines: migradrivePublicConfig.addressLines,
} as const;

export function buildLegalMetadata(input: {
  title: string;
  description: string;
  path: (typeof LEGAL_PAGE_PATHS)[keyof typeof LEGAL_PAGE_PATHS];
}): Metadata {
  return {
    title: input.title,
    description: input.description,
    alternates: {
      canonical: input.path,
    },
  };
}
