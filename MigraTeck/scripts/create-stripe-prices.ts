/**
 * One-shot script: creates Stripe products + recurring prices for every
 * purchasable product in PRODUCT_CATALOG that is missing a stripePriceId.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_… npx tsx scripts/create-stripe-prices.ts
 *
 * Output: a JSON map of { "PRODUCT_KEY:TierName": "price_xxx" } that you
 * paste back into constants.ts.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is required");
  process.exit(1);
}

const stripe = new Stripe(key, { typescript: true });

interface Tier {
  name: string;
  monthlyPrice: number; // cents
  contactSales?: boolean;
}

interface Product {
  key: string;
  name: string;
  tiers: Tier[];
}

// Products that need Stripe prices — excludes MigraMail (already done)
// and non-purchasable products.
const products: Product[] = [
  {
    key: "MIGRAHOSTING",
    name: "MigraHosting",
    tiers: [
      { name: "Starter", monthlyPrice: 499 },
      { name: "Premium", monthlyPrice: 599 },
      { name: "Business", monthlyPrice: 799 },
    ],
  },
  {
    key: "MIGRAVOICE",
    name: "MigraVoice",
    tiers: [
      { name: "Starter", monthlyPrice: 2499 },
      { name: "Business", monthlyPrice: 7999 },
      { name: "Professional", monthlyPrice: 17999 },
      { name: "Enterprise", monthlyPrice: 34999 },
    ],
  },
  {
    key: "MIGRAMARKET",
    name: "MigraMarket",
    tiers: [
      { name: "Local Visibility", monthlyPrice: 650 },
      { name: "Social + Email", monthlyPrice: 900 },
      { name: "Full Growth Engine", monthlyPrice: 2200 },
    ],
  },
  {
    key: "MIGRAPILOT",
    name: "MigraPilot",
    tiers: [
      { name: "Starter", monthlyPrice: 1500 },
      { name: "Business", monthlyPrice: 4900 },
      { name: "Enterprise", monthlyPrice: 14900 },
    ],
  },
  {
    key: "MIGRADRIVE",
    name: "MigraDrive",
    tiers: [
      { name: "Starter", monthlyPrice: 499 },
      { name: "Business", monthlyPrice: 1299 },
      { name: "Enterprise", monthlyPrice: 2999 },
    ],
  },
  {
    key: "MIGRAINVOICE",
    name: "MigraInvoice",
    tiers: [
      { name: "Starter", monthlyPrice: 1500 },
      { name: "Professional", monthlyPrice: 3900 },
      { name: "Advanced", monthlyPrice: 7900 },
      // Enterprise is contactSales — no price needed
    ],
  },
];

async function main() {
  const result: Record<string, string> = {};

  for (const product of products) {
    // Create Stripe product
    const stripeProduct = await stripe.products.create({
      name: product.name,
      metadata: { productKey: product.key, platform: "migrateck" },
    });

    console.log(`Created product: ${product.name} → ${stripeProduct.id}`);

    for (const tier of product.tiers) {
      if (tier.contactSales) continue;

      const price = await stripe.prices.create({
        product: stripeProduct.id,
        unit_amount: tier.monthlyPrice,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: {
          productKey: product.key,
          tierName: tier.name,
          platform: "migrateck",
        },
        nickname: `${product.name} – ${tier.name}`,
      });

      const mapKey = `${product.key}:${tier.name}`;
      result[mapKey] = price.id;
      console.log(`  ${tier.name}: $${(tier.monthlyPrice / 100).toFixed(2)}/mo → ${price.id}`);
    }
  }

  console.log("\n=== PRICE MAP (paste into constants.ts) ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
