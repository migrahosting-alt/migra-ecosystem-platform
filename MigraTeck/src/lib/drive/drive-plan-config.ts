import { ProductKey } from "@prisma/client";
import { getProductConfig, type PricingTier } from "@/lib/constants";

export interface MigraDrivePlanConfig {
  planCode: string;
  storageQuotaGb: number;
  pricingTier: PricingTier;
}

function toDrivePlanConfig(pricingTier: PricingTier): MigraDrivePlanConfig | null {
  if (!pricingTier.storageQuotaGb || pricingTier.storageQuotaGb <= 0) {
    return null;
  }

  return {
    planCode: (pricingTier.planCode || pricingTier.name).trim().toLowerCase(),
    storageQuotaGb: pricingTier.storageQuotaGb,
    pricingTier,
  };
}

export function listMigraDrivePlanConfigs(): MigraDrivePlanConfig[] {
  const config = getProductConfig(ProductKey.MIGRADRIVE);
  if (!config?.pricing?.length) {
    return [];
  }

  return config.pricing
    .map(toDrivePlanConfig)
    .filter((plan): plan is MigraDrivePlanConfig => Boolean(plan));
}

export function getDefaultMigraDrivePlanConfig(): MigraDrivePlanConfig {
  const plan = listMigraDrivePlanConfigs()[0];
  if (!plan) {
    throw new Error("MigraDrive product catalog is missing a provisionable plan configuration.");
  }

  return plan;
}

export function resolveMigraDrivePlanConfig(planCode: string): MigraDrivePlanConfig | null {
  const normalizedPlanCode = planCode.trim().toLowerCase();

  return listMigraDrivePlanConfigs().find((plan) => plan.planCode === normalizedPlanCode) || null;
}

export function resolveMigraDrivePlanConfigByPriceId(priceId: string): MigraDrivePlanConfig | null {
  return listMigraDrivePlanConfigs().find((plan) => plan.pricingTier.stripePriceId === priceId) || null;
}