/**
 * Seed billing-core PRODUCT_CATALOG prices into Stripe test mode.
 * Creates one Stripe Product per productFamily (or reuses existing).
 * Creates one Stripe Price per CatalogPrice entry, with lookup_key set.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/seed-billing-catalog.ts
 */
import Stripe from "stripe";
import { PRODUCT_CATALOG } from "../packages/billing-core/src/catalog/index";

async function main() {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) { console.error("STRIPE_SECRET_KEY required"); process.exit(1); }

  const stripe = new Stripe(key, { typescript: true });

  // Build a product per productFamily
  const productIds: Record<string, string> = {};
  for (const product of PRODUCT_CATALOG) {
    const existing = await stripe.products.search({
      query: `metadata['product_family']:'${product.productFamily}'`,
      limit: 1,
    });
    if (existing.data.length > 0) {
      productIds[product.productFamily] = existing.data[0].id;
      console.log(`  reuse product ${product.productFamily} → ${existing.data[0].id}`);
    } else {
      const p = await stripe.products.create({
        name: product.name,
        metadata: { product_family: product.productFamily, platform: "migrateck" },
      });
      productIds[product.productFamily] = p.id;
      console.log(`  created product ${product.productFamily} → ${p.id}`);
    }
  }

  // Collect unique prices across all plans
  const seen = new Set<string>();
  const toSeed: Array<{
    lookupKey: string;
    productFamily: string;
    unitAmount: number | null;
    interval: "month" | "year";
    meterName?: string;
  }> = [];
  for (const product of PRODUCT_CATALOG) {
    for (const plan of product.plans) {
      for (const price of plan.prices) {
        if (seen.has(price.lookupKey)) continue;
        seen.add(price.lookupKey);
        toSeed.push({
          lookupKey: price.lookupKey,
          productFamily: product.productFamily,
          unitAmount: price.unitAmount,
          interval: price.billingInterval as "month" | "year",
          meterName: price.meterName,
        });
      }
    }
  }

  console.log(`\nSeeding ${toSeed.length} catalog prices...`);

  for (const p of toSeed) {
    const productId = productIds[p.productFamily];
    if (!productId) {
      console.log(`  SKIP (no product): ${p.lookupKey}`);
      continue;
    }

    // Check if lookup_key already exists
    const existing = await stripe.prices.list({ lookup_keys: [p.lookupKey], limit: 1 });
    if (existing.data.length > 0) {
      console.log(`  EXISTS: ${p.lookupKey} → ${existing.data[0].id}`);
      continue;
    }

    try {
      const isMetered = p.unitAmount === null;
      const priceParams: Stripe.PriceCreateParams = {
        product: productId,
        currency: "usd",
        lookup_key: p.lookupKey,
        transfer_lookup_key: true,
        nickname: p.lookupKey,
        metadata: { platform: "migrateck", product_family: p.productFamily },
        unit_amount: isMetered ? 0 : (p.unitAmount ?? 0),
        recurring: {
          interval: p.interval,
          ...(isMetered ? { usage_type: "metered" } : {}),
        } as Stripe.PriceCreateParams.Recurring,
      };

      const created = await stripe.prices.create(priceParams);
      console.log(`  CREATED: ${p.lookupKey} → ${created.id}`);
    } catch (e: any) {
      console.log(`  ERROR (${p.lookupKey}): ${e.message}`);
    }
  }

  console.log("\nDone — all catalog lookup keys seeded in Stripe test mode.");
}

main().catch((e) => { console.error(e); process.exit(1); });
