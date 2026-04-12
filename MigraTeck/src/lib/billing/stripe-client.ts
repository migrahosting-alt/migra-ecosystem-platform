import Stripe from "stripe";
import { env, stripeBillingEnabled } from "@/lib/env";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeBillingEnabled || !env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe billing is not enabled.");
  }

  if (!_stripe) {
    _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
      typescript: true,
    });
  }

  return _stripe;
}
