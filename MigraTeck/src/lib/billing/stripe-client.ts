import Stripe from "stripe";
import { env, stripeBillingEnabled } from "@/lib/env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeBillingEnabled || !env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe billing is not enabled.");
  }

  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2025-02-24.acacia" as Stripe.LatestApiVersion,
      typescript: true,
    });
  }

  return _stripe;
}

/**
 * Convenience export — the Stripe client instance.
 * Must only be called from server-side code when STRIPE_BILLING_ENABLED=true.
 */
export { getStripe as stripe };
