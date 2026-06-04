/**
 * Stripe payment-link generation for ad-hoc order charges.
 *
 * Used by the add-product flow's "Send payment link" button — creates a
 * one-shot Stripe Payment Link for a single line item and returns the URL.
 *
 * Config (env on app-core):
 *   STRIPE_SECRET_KEY=<live or test Stripe secret key>
 *
 * If unconfigured, the helper returns null and the caller should fall back to
 * the "queue invoice via worker" path.
 */

export type StripeLinkInput = {
  productName: string;
  amountCents: number;     // total amount in cents (subtotal + tax)
  currency?: string;       // default "usd"
  metadata?: Record<string, string>;
  successUrl?: string;
};

export type StripeLinkResult = {
  url: string;
  id: string;
};

const stripeFetch = async <T>(path: string, body: URLSearchParams): Promise<T> => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const json = (await res.json()) as { error?: { message?: string } } & T;
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `Stripe error (${res.status})`);
  }
  return json;
};

export const createPaymentLink = async (
  input: StripeLinkInput,
): Promise<StripeLinkResult | null> => {
  if (!process.env.STRIPE_SECRET_KEY) return null;

  // Step 1: create a Price (ad-hoc, tied to an inline product)
  const priceForm = new URLSearchParams();
  priceForm.set("currency", input.currency || "usd");
  priceForm.set("unit_amount", String(Math.max(0, Math.round(input.amountCents))));
  priceForm.set("product_data[name]", input.productName.slice(0, 250));
  const price = await stripeFetch<{ id: string }>("prices", priceForm);

  // Step 2: create a Payment Link referencing that price
  const linkForm = new URLSearchParams();
  linkForm.set("line_items[0][price]", price.id);
  linkForm.set("line_items[0][quantity]", "1");
  if (input.successUrl) {
    linkForm.set("after_completion[type]", "redirect");
    linkForm.set("after_completion[redirect][url]", input.successUrl);
  }
  if (input.metadata) {
    for (const [k, v] of Object.entries(input.metadata)) {
      linkForm.set(`metadata[${k}]`, String(v).slice(0, 500));
    }
  }
  const link = await stripeFetch<{ id: string; url: string }>("payment_links", linkForm);
  return { id: link.id, url: link.url };
};
